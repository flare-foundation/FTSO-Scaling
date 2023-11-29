import { ContractAddresses } from "./utils/ContractAddresses";
import { EpochSettings } from "./utils/EpochSettings";
import {
  Address,
  BlockData,
  FinalizeData,
  PriceEpochId,
  RevealBitvoteData,
  RewardEpochId,
  RewardOffered,
  SignatureData,
  TxData,
} from "./voting-types";
import AsyncEventEmitter from "./utils/AsyncEventEmitter";
import EncodingUtils from "./utils/EncodingUtils";
import { promiseWithTimeout } from "../utils/retry";
import { getLogger } from "../utils/logger";
import { asError } from "./utils/error";

declare type CommitHash = string;
declare type Timestamp = number;

export enum Event {
  Commit = "commit",
  Reveal = "reveal",
  Signature = "signature",
  Finalize = "finalize",
  Offers = "offers",
  RewardSignature = "rewardSignature",
  RewardFinalize = "rewardFinalize",
  BlockTimestamp = "blockTimestamp",
}

/** Processes transaction blocks and emits events based on the type of extracted data. */
export class BlockIndex extends AsyncEventEmitter {
  private readonly priceEpochCommits = new Map<PriceEpochId, Map<Address, CommitHash>>();
  private readonly priceEpochReveals = new Map<PriceEpochId, Map<Address, RevealBitvoteData>>();
  private readonly priceEpochSignatures = new Map<PriceEpochId, Map<Address, [SignatureData, Timestamp]>>();
  private readonly priceEpochFinalizes = new Map<PriceEpochId, [FinalizeData, Timestamp]>();

  private readonly rewardSignatures = new Map<RewardEpochId, Map<Address, [SignatureData, Timestamp]>>();
  private readonly rewardFinalizes = new Map<RewardEpochId, [FinalizeData, Timestamp]>();
  private readonly rewardEpochOffers = new Map<RewardEpochId, RewardOffered[]>();

  protected readonly encodingUtils = EncodingUtils.instance;

  constructor(protected readonly epochs: EpochSettings, protected readonly contractAddresses: ContractAddresses) {
    super();
  }

  getCommits(priceEpochId: PriceEpochId): Map<Address, CommitHash> {
    return this.priceEpochCommits.get(priceEpochId) ?? new Map();
  }

  getReveals(priceEpochId: PriceEpochId): Map<Address, RevealBitvoteData> {
    return this.priceEpochReveals.get(priceEpochId) ?? new Map();
  }

  getSignatures(priceEpochId: PriceEpochId): Map<Address, [SignatureData, Timestamp]> {
    return this.priceEpochSignatures.get(priceEpochId) ?? new Map();
  }

  getFinalize(priceEpochId: PriceEpochId): [FinalizeData, Timestamp] | undefined {
    return this.priceEpochFinalizes.get(priceEpochId);
  }

  getRewardSignatures(rewardEpochId: RewardEpochId): Map<Address, [SignatureData, Timestamp]> {
    return this.rewardSignatures.get(rewardEpochId) ?? new Map();
  }

  getRewardFinalize(rewardEpochId: RewardEpochId): [FinalizeData, Timestamp] | undefined {
    return this.rewardFinalizes.get(rewardEpochId);
  }

  getRewardOffers(rewardEpochId: RewardEpochId): RewardOffered[] {
    return this.rewardEpochOffers.get(rewardEpochId) ?? [];
  }

  async processBlock(block: BlockData) {
    for (const tx of block.transactions) {
      await this.processTx(tx, block.timestamp);
    }
  }

  async processTx(tx: TxData, blockTimestampSec: number, debug: boolean = false): Promise<void> {
    const prefix = tx.input?.slice(0, 10);
    if (tx.to?.toLowerCase() === this.contractAddresses.voting.toLowerCase()) {
      if (prefix && prefix.length === 10) {
        if (prefix === this.encodingUtils.functionSignature("commit")) {
          return this.extractCommit(tx, blockTimestampSec);
        } else if (prefix === this.encodingUtils.functionSignature("revealBitvote")) {
          return this.extractReveal(tx, blockTimestampSec);
        } else if (prefix === this.encodingUtils.functionSignature("signResult")) {
          return this.extractSignature(tx, blockTimestampSec);
        } else if (prefix === this.encodingUtils.functionSignature("finalize")) {
          return this.extractFinalize(tx, blockTimestampSec);
        } else if (prefix === this.encodingUtils.functionSignature("signRewards")) {
          return this.extractRewardSignature(tx, blockTimestampSec);
        } else if (prefix === this.encodingUtils.functionSignature("finalizeRewards")) {
          return this.extractFinalizeRewards(tx, blockTimestampSec);
        }
      }
    } else if (tx.to?.toLowerCase() === this.contractAddresses.votingRewardManager.toLowerCase()) {
      if (prefix === this.encodingUtils.functionSignature("offerRewards")) {
        return this.extractOffers(tx, blockTimestampSec);
      }
    }
  }

  private _lastBlockTimestampSec: number = 0;

  blockProcessed(timestampSec: number) {
    this._lastBlockTimestampSec = timestampSec;
    this.emit(Event.BlockTimestamp, timestampSec);
  }

  /**
   * Waits for a block with timestamp greater than {@link blockTimestampSec} to be processed.
   */
  async awaitLaterBlock(blockTimestampSec: number): Promise<void> {
    if (this._lastBlockTimestampSec > blockTimestampSec) {
      getLogger("Index").info(`Block ${this._lastBlockTimestampSec} already processed, provided: ${blockTimestampSec}.`);  
      return;
    }
    getLogger("Index").info(`Waiting for block later than ${blockTimestampSec} to be processed.`);

    var resolvePromise: () => void;
    const promise = new Promise<void>(function (resolve, _) {
      resolvePromise = resolve;
    });
    const listener = (timestampSec: number) => {
      if (timestampSec > blockTimestampSec) {
        getLogger("Index").info(`Got timestamp ${timestampSec} larger than deadline ${blockTimestampSec}.`);
        resolvePromise();
      }
    };
    this.on(Event.BlockTimestamp, listener);
    try {
      await promiseWithTimeout(promise, (blockTimestampSec - Date.now() / 1000 + 15) * 1000); // Time out 15 seconds after deadline
    } catch (e) {
      throw new Error(
        `Timeout waiting for block later than ${blockTimestampSec} to be processed, current time: ${Date.now() / 1000}`,
        { cause: asError(e) }
      );
    } finally {
      this.removeListener(Event.BlockTimestamp, listener);
    }
  }

  private async extractFinalize(tx: TxData, blockTimestampSec: number) {
    const finalizeData = this.encodingUtils.extractFinalize(tx);
    if (finalizeData.confirmed) {
      if (this.priceEpochFinalizes.has(finalizeData.epochId)) {
        throw new Error(
          `Finalize data already exists for epoch ${finalizeData.epochId}: ${JSON.stringify(
            this.priceEpochFinalizes.get(finalizeData.epochId)
          )}, received ${JSON.stringify(finalizeData)}`
        );
      }
      this.priceEpochFinalizes.set(finalizeData.epochId, [finalizeData, blockTimestampSec]);
      await this.emit(Event.Finalize, tx.from, finalizeData);
    }
  }

  private async extractFinalizeRewards(tx: TxData, blockTimestampSec: number) {
    const finalizeData = this.encodingUtils.extractRewardFinalize(tx);
    if (finalizeData.confirmed) {
      if (this.rewardFinalizes.has(finalizeData.epochId)) {
        throw new Error(
          `Finalize rewards data already exists for epoch ${finalizeData.epochId}: ${this.priceEpochFinalizes.get(
            finalizeData.epochId
          )}, received ${finalizeData}`
        );
      }
      this.rewardFinalizes.set(finalizeData.epochId, [finalizeData, blockTimestampSec]);
      await this.emit(Event.RewardFinalize, tx.from, finalizeData);
    }
  }

  /**
   * Extract offers from transaction input.
   * Assumption: the transaction is a call to `offerRewards` function.
   */
  // TODO: we need to somehow lock the reward offer set once the reward epoch starts – maybe take a snapshot in the beginning of the epoch?
  private async extractOffers(tx: TxData, blockTimestampSec: number): Promise<void> {
    const offers = this.encodingUtils.extractOffers(tx);
    const priceEpochId = this.epochs.priceEpochIdForTime(blockTimestampSec);
    const offerRewardEpochId = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);

    const forRewardEpoch = offerRewardEpochId + 1;
    const offersInEpoch = this.rewardEpochOffers.get(forRewardEpoch) ?? [];
    this.rewardEpochOffers.set(forRewardEpoch, offersInEpoch);
    for (const offer of offers) {
      offersInEpoch.push(offer);
    }
    await this.emit(Event.Offers, priceEpochId, offers);
  }

  // commit(bytes32 _commitHash)
  private extractCommit(tx: TxData, blockTimestampSec: number): void {
    const hash: CommitHash = this.encodingUtils.extractCommitHash(tx);
    const from = tx.from.toLowerCase();
    const priceEpochId = this.epochs.priceEpochIdForTime(blockTimestampSec);
    const commitsInEpoch = this.priceEpochCommits.get(priceEpochId) || new Map<Address, CommitHash>();
    this.priceEpochCommits.set(priceEpochId, commitsInEpoch);
    commitsInEpoch.set(from.toLowerCase(), hash);
  }

  private extractReveal(tx: TxData, blockTimestampSec: number): void {
    const result = this.encodingUtils.extractRevealBitvoteData(tx);
    const from = tx.from.toLowerCase();
    const priceEpochId = this.epochs.revealPriceEpochIdForTime(blockTimestampSec);

    if (priceEpochId !== undefined) {
      const revealsInEpoch = this.priceEpochReveals.get(priceEpochId) || new Map<Address, RevealBitvoteData>();
      this.priceEpochReveals.set(priceEpochId, revealsInEpoch);
      revealsInEpoch.set(from.toLowerCase(), result);
    }
  }

  private async extractSignature(tx: TxData, blockTimestampSec: number): Promise<void> {
    const signatureData = this.encodingUtils.extractSignatureData(tx);
    const from = tx.from.toLowerCase();
    const signaturesInEpoch =
      this.priceEpochSignatures.get(signatureData.epochId) || new Map<Address, [SignatureData, Timestamp]>();

    this.priceEpochSignatures.set(signatureData.epochId, signaturesInEpoch);
    signaturesInEpoch.set(from.toLowerCase(), [signatureData, blockTimestampSec]);

    await this.emit(Event.Signature, signatureData);
  }

  private async extractRewardSignature(tx: TxData, blockTimestampSec: number): Promise<void> {
    const signatureData = this.encodingUtils.extractRewardSignatureData(tx);
    const from = tx.from.toLowerCase();
    const signaturesInEpoch =
      this.rewardSignatures.get(signatureData.epochId) || new Map<Address, [SignatureData, Timestamp]>();

    this.rewardSignatures.set(signatureData.epochId, signaturesInEpoch);
    signaturesInEpoch.set(from.toLowerCase(), [signatureData, blockTimestampSec]);

    await this.emit(Event.RewardSignature, signatureData);
  }
}
