import { ContractAddresses } from "../deployment/tasks/common";
import { EpochSettings } from "./EpochSettings";
import { BlockData, FinalizeData, RevealBitvoteData, SignatureData, TxData } from "./voting-interfaces";
import AsyncEventEmitter from "./utils/AsyncEventEmitter";
import EncodingUtils from "./EncodingUtils";

declare type Address = string;
declare type EpochId = number;
declare type CommitHash = string;
declare type Timestamp = number;

export enum Received {
  Commit = "commit",
  Reveal = "reveal",
  Signature = "signature",
  Finalize = "finalize",
  Offers = "offers",
}

/** Processes transaction blocks and emits events based on the type of extracted data. */
export class BlockIndexer extends AsyncEventEmitter {
  private readonly priceEpochCommits = new Map<EpochId, Map<Address, CommitHash>>();
  private readonly priceEpochReveals = new Map<EpochId, Map<Address, RevealBitvoteData>>();
  private readonly priceEpochSignatures = new Map<EpochId, Map<Address, [SignatureData, Timestamp]>>();
  private readonly priceEpochFinalizes = new Map<EpochId, [FinalizeData, Timestamp]>();
  private readonly encodingUtils = EncodingUtils.instance;

  constructor(private readonly epochs: EpochSettings, private readonly contractAddresses: ContractAddresses) {
    super();
  }

  getCommits(priceEpochId: EpochId): Map<Address, CommitHash> {
    return this.priceEpochCommits.get(priceEpochId) ?? new Map();
  }

  getReveals(priceEpochId: EpochId): Map<Address, RevealBitvoteData> {
    return this.priceEpochReveals.get(priceEpochId) ?? new Map();
  }

  getSignatures(priceEpochId: EpochId): Map<Address, [SignatureData, Timestamp]> {
    return this.priceEpochSignatures.get(priceEpochId) ?? new Map();
  }

  getFinalize(priceEpochId: EpochId): [FinalizeData, Timestamp] | undefined {
    return this.priceEpochFinalizes.get(priceEpochId);
  }

  async processBlock(block: BlockData) {
    for (const tx of block.transactions) {
      await this.processTx(tx, block.timestamp);
    }
  }

  private async processTx(tx: TxData, blockTimestampSec: number): Promise<void> {
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
        }
      }
    } else if (tx.to?.toLowerCase() === this.contractAddresses.votingRewardManager.toLowerCase()) {
      if (prefix === this.encodingUtils.functionSignature("offerRewards")) {
        return this.extractOffers(tx, blockTimestampSec);
      }
    }
  }

  private async extractFinalize(tx: TxData, blockTimestampSec: number) {
    const successful = tx.receipt!.status == true;
    if (successful) {
      const finalizeData = this.encodingUtils.extractFinalize(tx);
      if (this.priceEpochFinalizes.has(finalizeData.epochId)) {
        throw new Error(`Finalize data already exists for epoch ${finalizeData.epochId}`);
      }
      this.priceEpochFinalizes.set(finalizeData.epochId, [finalizeData, blockTimestampSec]);
      await this.emit(Received.Finalize, tx.from, finalizeData);
    }
  }

  /**
   * Extract offers from transaction input.
   * Assumption: the transaction is a call to `offerRewards` function.
   */
  private async extractOffers(tx: TxData, blockTimestampSec: number): Promise<void> {
    const offers = this.encodingUtils.extractOffers(tx);
    const priceEpochId = this.epochs.priceEpochIdForTime(blockTimestampSec);
    await this.emit(Received.Offers, priceEpochId, offers);
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

  // function revealBitvote(bytes32 _random, bytes32 _merkleRoot, bytes calldata _bitVote, bytes calldata _prices)
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

  // function signResult(bytes32 _merkleRoot, Signature calldata signature)
  private async extractSignature(tx: TxData, blockTimestampSec: number): Promise<void> {
    const signatureData = this.encodingUtils.extractSignatureData(tx);
    const from = tx.from.toLowerCase();
    const signaturesInEpoch =
      this.priceEpochSignatures.get(signatureData.epochId) || new Map<Address, [SignatureData, Timestamp]>();

    this.priceEpochSignatures.set(signatureData.epochId, signaturesInEpoch);
    signaturesInEpoch.set(from.toLowerCase(), [signatureData, blockTimestampSec]);

    await this.emit(Received.Signature, signatureData.epochId);
  }
}
