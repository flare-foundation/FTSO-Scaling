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
import { FtsoLog, FtsoTransaction, State } from "./Entity";
import { Between, DataSource } from "typeorm";
import { getDataSource } from "../DataSource";

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

class DBCache {
  readonly priceEpochCommits = new Map<PriceEpochId, Map<Address, CommitHash>>();
  readonly priceEpochReveals = new Map<PriceEpochId, Map<Address, RevealBitvoteData>>();
  readonly priceEpochSignatures = new Map<PriceEpochId, Map<Address, [SignatureData, Timestamp]>>();
  readonly priceEpochFinalizes = new Map<PriceEpochId, [FinalizeData, Timestamp]>();
  readonly rewardSignatures = new Map<RewardEpochId, Map<Address, [SignatureData, Timestamp]>>();
  readonly rewardFinalizes = new Map<RewardEpochId, [FinalizeData, Timestamp]>();
  readonly rewardEpochOffers = new Map<RewardEpochId, RewardOffered[]>();
}

export class IndexerClient extends AsyncEventEmitter {
  private readonly cache = new DBCache();

  protected readonly encodingUtils = EncodingUtils.instance;

  private dataSource!: DataSource;

  constructor(
    private readonly id: number,
    protected readonly epochs: EpochSettings,
    protected readonly contractAddresses: ContractAddresses
  ) {
    super();
  }

  async initialize() {
    this.dataSource = await getDataSource(true);
  }

  async getMaxTimestamp(): Promise<number> {
    const state = await this.dataSource.getRepository(State).findOneBy({ id: 0 });
    return state!.index;
  }

  async queryCommits(priceEpochId: PriceEpochId): Promise<Map<Address, CommitHash>> {
    const cached = this.cache.priceEpochCommits.get(priceEpochId);
    if (cached) return cached;

    const start = this.epochs.priceEpochStartTimeSec(priceEpochId);
    const nextStart = this.epochs.priceEpochStartTimeSec(priceEpochId + 1);

    const max = await this.getMaxTimestamp();
    if (max < nextStart) {
      throw new Error(`Incomplete commit picture for current price epoch`);
    }

    const txns: FtsoTransaction[] = await this.dataSource.getRepository(FtsoTransaction).find({
      where: {
        func_sig: this.encodingUtils.functionSignature("commit").slice(2),
        timestamp: Between(start, nextStart - 1),
      },
    });

    const epochCommits = new Map<Address, CommitHash>();
    for (const tx of txns) {
      const extractedCommit = this.encodingUtils.extractCommitHash(tx.toTxData());
      getLogger("IndexerClient").info(`Got commit response ${tx.from} - ${extractedCommit}`);
      epochCommits.set("0x" + tx.from.toLowerCase(), extractedCommit);
    }

    return epochCommits;
  }

  async queryReveals(priceEpochId: PriceEpochId): Promise<Map<Address, RevealBitvoteData>> {
    const cached = this.cache.priceEpochReveals.get(priceEpochId);
    if (cached) return cached;

    const start = this.epochs.priceEpochStartTimeSec(priceEpochId + 1);
    const revealDeadline = this.epochs.revealDeadlineSec(priceEpochId + 1);

    const max = await this.getMaxTimestamp();
    if (max < revealDeadline) {
      throw new Error(`Incomplete reveal picture for current price epoch`);
    }

    const txns: FtsoTransaction[] = await this.dataSource.getRepository(FtsoTransaction).find({
      where: {
        func_sig: this.encodingUtils.functionSignature("revealBitvote").slice(2),
        timestamp: Between(start, revealDeadline),
      },
    });

    getLogger("IndexerClient").info(
      `Got ${txns.length} reveal transactions, fn sig ${this.encodingUtils
        .functionSignature("revealBitvote")
        .slice(2)}, time interaval: ${start} - ${revealDeadline}, timestamp: ${txns[0]?.timestamp}`
    );

    const epochReveals = new Map<Address, RevealBitvoteData>();
    for (const tx of txns) {
      const reveal = this.encodingUtils.extractRevealBitvoteData(tx.toTxData());
      getLogger("IndexerClient").info(`Got reveal response ${tx.from} - ${reveal}`);
      epochReveals.set("0x" + tx.from.toLowerCase(), reveal);
    }

    return epochReveals;
  }

  async querySignatures(priceEpochId: PriceEpochId): Promise<Map<Address, [SignatureData, Timestamp]>> {
    const cached = this.cache.priceEpochSignatures.get(priceEpochId);
    if (cached) {
      getLogger("IndexerClient").info(`Got cached signatures for epoch ${priceEpochId}`);
      return cached;
    }

    const start = this.epochs.priceEpochStartTimeSec(priceEpochId);
    const nextStart = this.epochs.priceEpochStartTimeSec(priceEpochId + 1);

    getLogger("IndexerClient").info(
      `Querying signatures for epoch ${priceEpochId}, time interval: ${start} - ${nextStart}`
    );

    const txns: FtsoTransaction[] = await this.dataSource.getRepository(FtsoTransaction).find({
      where: {
        func_sig: this.encodingUtils.functionSignature("signResult").slice(2),
        timestamp: Between(start, nextStart - 1),
      },
    });

    const signatures = new Map<Address, [SignatureData, Timestamp]>();
    for (const tx of txns) {
      const sig = this.encodingUtils.extractSignatureData(tx.toTxData());
      getLogger("IndexerClient").info(`Got signature ${tx.from} - ${sig.merkleRoot}`);
      signatures.set("0x" + tx.from.toLowerCase(), [sig, tx.timestamp]);
    }

    if ((await this.getMaxTimestamp()) > nextStart) {

      this.cache.priceEpochSignatures.set(priceEpochId, signatures);
    }

    return signatures;
  }

  async queryFinalize(priceEpochId: PriceEpochId): Promise<[FinalizeData, Timestamp] | undefined> {
    const finalizeEpoch = priceEpochId - 1;
    const cached = this.cache.priceEpochFinalizes.get(finalizeEpoch);
    if (cached) return cached;

    const start = this.epochs.priceEpochStartTimeSec(priceEpochId);
    const nextStart = this.epochs.priceEpochStartTimeSec(priceEpochId + 1);

    const tx = await this.dataSource.getRepository(FtsoTransaction).findOne({
      where: {
        func_sig: this.encodingUtils.functionSignature("finalize").slice(2),
        timestamp: Between(start, nextStart - 1),
        status: true,
      },
    });

    if (tx === null) {
      return undefined;
    }

    const f = this.encodingUtils.extractFinalize(tx.toTxData());
    getLogger("IndexerClient").info(`Got finalize ${tx.from} - ${f.epochId}`);
    this.cache.priceEpochFinalizes.set(finalizeEpoch, [f, tx.timestamp]);
    return [f, tx.timestamp];
  }

  // async getRewardSignatures(rewardEpochId: RewardEpochId): Promise<Map<Address, [SignatureData, Timestamp]>> {
  //   const cached = this.cache.rewardSignatures.get(rewardEpochId);
  //   if (cached) return cached;

  //   const start = this.epochs.priceEpochStartTimeSec(this.epochs.firstPriceEpochForRewardEpoch(rewardEpochId));
  //   const nextStart = this.epochs.priceEpochStartTimeSec(this.epochs.lastPriceEpochForRewardEpoch(rewardEpochId) + 1);

  //   const txns: FtsoTransaction[] = await this.dataSource.getRepository(FtsoTransaction).find({
  //     where: {
  //       func_sig: this.encodingUtils.functionSignature("signRewards").slice(2),
  //       timestamp: Between(start, nextStart - 1),
  //     },
  //   });

  //   const signatures = new Map<Address, [SignatureData, Timestamp]>();
  //   for (const tx of txns) {
  //     const sig = this.encodingUtils.extractSignatureData(tx.toTxData());
  //     getLogger("IndexerClient").info(`Got reward signature ${tx.from} - ${sig.merkleRoot}`);
  //     signatures.set("0x" + tx.from.toLowerCase(), [sig, tx.timestamp]);
  //   }

  //   this.cache.rewardSignatures.set(rewardEpochId, signatures);
  //   return signatures;
  // }

  // getRewardFinalize(rewardEpochId: RewardEpochId): [FinalizeData, Timestamp] | undefined {
  //   return this.cache.rewardFinalizes.get(rewardEpochId);
  // }

  async getRewardOffers(rewardEpochId: RewardEpochId): Promise<RewardOffered[]> {
    const cached = this.cache.rewardEpochOffers.get(rewardEpochId);
    if (cached) return cached;

    const start = this.epochs.priceEpochStartTimeSec(this.epochs.firstPriceEpochForRewardEpoch(rewardEpochId - 1));
    const nextStart = this.epochs.priceEpochStartTimeSec(
      this.epochs.lastPriceEpochForRewardEpoch(rewardEpochId - 1) + 1
    );

    const txns = await this.dataSource.getRepository(FtsoTransaction).find({
      where: {
        func_sig: this.encodingUtils.functionSignature("offerRewards").slice(2),
        timestamp: Between(start, nextStart - 1),
        status: true,
      },
    });

    const rewardOffers: RewardOffered[] = [];
    for (const tx of txns) {
      const logs = await this.dataSource.getRepository(FtsoLog).findOne({
        where: {
          tx_hash: tx.hash,
        },
      });
      const offers = this.encodingUtils.extractOffers({
        ...tx.toTxData(),
        logs: JSON.parse(logs!.log),
      } as TxData);
      getLogger("IndexerClient").info(`Got reward offers ${tx.from} - ${offers.length}`);
      rewardOffers.push(...offers);
    }

    this.cache.rewardEpochOffers.set(rewardEpochId, rewardOffers);

    return rewardOffers;
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
          this.extractCommit(tx, blockTimestampSec);
        } else if (prefix === this.encodingUtils.functionSignature("revealBitvote")) {
          this.extractReveal(tx, blockTimestampSec);
        } else if (prefix === this.encodingUtils.functionSignature("signResult")) {
          this.extractSignature(tx, blockTimestampSec);
        } else if (prefix === this.encodingUtils.functionSignature("finalize")) {
          this.extractFinalize(tx, blockTimestampSec);
        } else if (prefix === this.encodingUtils.functionSignature("signRewards")) {
          this.extractRewardSignature(tx, blockTimestampSec);
        } else if (prefix === this.encodingUtils.functionSignature("finalizeRewards")) {
          this.extractFinalizeRewards(tx, blockTimestampSec);
        }
      }
    } else if (tx.to?.toLowerCase() === this.contractAddresses.votingRewardManager.toLowerCase()) {
      if (prefix === this.encodingUtils.functionSignature("offerRewards")) {
        this.extractOffers(tx, blockTimestampSec);
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
      getLogger("Index").info(
        `Block ${this._lastBlockTimestampSec} already processed, provided: ${blockTimestampSec}.`
      );
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
      if (this.cache.priceEpochFinalizes.has(finalizeData.epochId)) {
        throw new Error(
          `Finalize data already exists for epoch ${finalizeData.epochId}: ${JSON.stringify(
            this.cache.priceEpochFinalizes.get(finalizeData.epochId)
          )}, received ${JSON.stringify(finalizeData)}`
        );
      }
      this.cache.priceEpochFinalizes.set(finalizeData.epochId, [finalizeData, blockTimestampSec]);
      await this.emit(Event.Finalize, tx.from, finalizeData);
    }
  }

  private async extractFinalizeRewards(tx: TxData, blockTimestampSec: number) {
    const finalizeData = this.encodingUtils.extractRewardFinalize(tx);
    if (finalizeData.confirmed) {
      if (this.cache.rewardFinalizes.has(finalizeData.epochId)) {
        throw new Error(
          `Finalize rewards data already exists for epoch ${finalizeData.epochId}: ${this.cache.priceEpochFinalizes.get(
            finalizeData.epochId
          )}, received ${finalizeData}`
        );
      }
      this.cache.rewardFinalizes.set(finalizeData.epochId, [finalizeData, blockTimestampSec]);
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
    const offersInEpoch = this.cache.rewardEpochOffers.get(forRewardEpoch) ?? [];
    this.cache.rewardEpochOffers.set(forRewardEpoch, offersInEpoch);
    for (const offer of offers) {
      offersInEpoch.push(offer);
    }
    await this.emit(Event.Offers, priceEpochId, offers);
  }

  // commit(bytes32 _commitHash)
  private extractCommit(tx: TxData, blockTimestampSec: number): CommitHash {
    const hash: CommitHash = this.encodingUtils.extractCommitHash(tx);
    const from = tx.from.toLowerCase();
    const priceEpochId = this.epochs.priceEpochIdForTime(blockTimestampSec);
    // const commitsInEpoch = this.cache.priceEpochCommits.get(priceEpochId) || new Map<Address, CommitHash>();
    // this.cache.priceEpochCommits.set(priceEpochId, commitsInEpoch);
    // commitsInEpoch.set(from.toLowerCase(), hash);
    return hash;
  }

  private extractReveal(tx: TxData, blockTimestampSec: number): RevealBitvoteData {
    const result = this.encodingUtils.extractRevealBitvoteData(tx);
    return result;
    // const priceEpochId = this.epochs.revealPriceEpochIdForTime(blockTimestampSec);

    // if (priceEpochId !== undefined) {
    //   const revealsInEpoch = this.cache.priceEpochReveals.get(priceEpochId) || new Map<Address, RevealBitvoteData>();
    //   this.cache.priceEpochReveals.set(priceEpochId, revealsInEpoch);
    //   revealsInEpoch.set(from.toLowerCase(), result);
    //   return result;
    // }
  }

  private async extractSignature(tx: TxData, blockTimestampSec: number): Promise<void> {
    const signatureData = this.encodingUtils.extractSignatureData(tx);
    const from = tx.from.toLowerCase();
    const signaturesInEpoch =
      this.cache.priceEpochSignatures.get(signatureData.epochId) || new Map<Address, [SignatureData, Timestamp]>();

    this.cache.priceEpochSignatures.set(signatureData.epochId, signaturesInEpoch);
    signaturesInEpoch.set(from.toLowerCase(), [signatureData, blockTimestampSec]);

    await this.emit(Event.Signature, signatureData);
  }

  private async extractRewardSignature(tx: TxData, blockTimestampSec: number): Promise<void> {
    const signatureData = this.encodingUtils.extractRewardSignatureData(tx);
    const from = tx.from.toLowerCase();
    const signaturesInEpoch =
      this.cache.rewardSignatures.get(signatureData.epochId) || new Map<Address, [SignatureData, Timestamp]>();

    this.cache.rewardSignatures.set(signatureData.epochId, signaturesInEpoch);
    signaturesInEpoch.set(from.toLowerCase(), [signatureData, blockTimestampSec]);

    await this.emit(Event.RewardSignature, signatureData);
  }
}
