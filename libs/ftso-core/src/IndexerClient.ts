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
import { asError } from "./utils/error";
import { Between, EntityManager } from "typeorm";
import { promiseWithTimeout } from "../../../apps/ftso-calculator/src/utils/retry";
import { TLPEvents, TLPState, TLPTransaction } from "./orm/entities";
import { toBN } from "./utils/voting-utils";

import BN from "bn.js";

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

function toTxData(tx: TLPTransaction): TxData {
  const txData: TxData = {
    hash: tx.hash,
    input: "0x" + tx.input,
    from: "0x" + tx.from_address,
    to: "0x" + tx.to_address,
    blockNumber: tx.block_number,
    status: tx.status == 1,
  };
  return txData;
}

export class IndexerClient extends AsyncEventEmitter {
  private readonly cache = new DBCache();

  protected readonly encodingUtils = () => EncodingUtils.instance;

  constructor(private readonly entityManager: EntityManager, protected readonly epochs: EpochSettings) {
    super();
  }

  /** We should retrieve weights from tx event logs. */
  async getFakeVoterWeights(rewardEpochId: number): Promise<Map<Address, BN>> {
    const currentTime = Date.now() / 1000;
    const txns: TLPTransaction[] = await this.entityManager.getRepository(TLPTransaction).find({
      where: {
        function_sig: this.encodingUtils().functionSignature("commit").slice(2),
        timestamp: Between(currentTime - 3600, currentTime),
      },
    });
    const fakeWeights = new Map<Address, BN>();
    for (const addr of txns.map(tx => tx.from_address.toLowerCase())) {
      fakeWeights.set(addr, toBN(1000));
    }
    return fakeWeights;
  }

  async getMaxTimestamp(): Promise<number> {
    const state = await this.entityManager.getRepository(TLPState).findOneBy({ id: 3 });
    return state!.block_timestamp;
  }

  async queryCommits(priceEpochId: PriceEpochId): Promise<Map<Address, CommitHash>> {
    const cached = this.cache.priceEpochCommits.get(priceEpochId);
    if (cached) return cached;

    const start = this.epochs.priceEpochStartTimeSec(priceEpochId);
    const nextStart = this.epochs.priceEpochStartTimeSec(priceEpochId + 1);

    const max = await this.getMaxTimestamp();
    if (max < nextStart) {
      throw new Error(`Incomplete commit picture for current price epoch: ${max} < ${nextStart}}`);
    }

    const txns: TLPTransaction[] = await this.entityManager.getRepository(TLPTransaction).find({
      where: {
        function_sig: this.encodingUtils().functionSignature("commit").slice(2),
        timestamp: Between(start, nextStart - 1),
      },
    });

    const epochCommits = new Map<Address, CommitHash>();
    for (const tx of txns) {
      const extractedCommit = this.encodingUtils().extractCommitHash(toTxData(tx));
      // console.log(`Got commit response ${tx.from_address} - ${extractedCommit}`);
      epochCommits.set("0x" + tx.from_address.toLowerCase(), extractedCommit);
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

    const txns: TLPTransaction[] = await this.entityManager.getRepository(TLPTransaction).find({
      where: {
        function_sig: this.encodingUtils().functionSignature("revealBitvote").slice(2),
        timestamp: Between(start, revealDeadline),
      },
    });

    // getLogger("IndexerClient").info(
    //   `Got ${txns.length} reveal transactions, fn sig ${this.encodingUtils
    //     .functionSignature("revealBitvote")
    //     .slice(2)}, time interaval: ${start} - ${revealDeadline}, timestamp: ${txns[0]?.timestamp}`
    // );

    const epochReveals = new Map<Address, RevealBitvoteData>();
    for (const tx of txns) {
      const reveal = this.encodingUtils().extractRevealBitvoteData(toTxData(tx));
      // console.log(`Got reveal response ${tx.from_address} - ${reveal}`);
      epochReveals.set("0x" + tx.from_address.toLowerCase(), reveal);
    }

    return epochReveals;
  }

  async querySignatures(priceEpochId: PriceEpochId): Promise<Map<Address, [SignatureData, Timestamp]>> {
    const cached = this.cache.priceEpochSignatures.get(priceEpochId);
    if (cached) {
      // getLogger("IndexerClient").info(`Got cached signatures for epoch ${priceEpochId}`);
      return cached;
    }

    const start = this.epochs.priceEpochStartTimeSec(priceEpochId + 1);
    const nextStart = this.epochs.priceEpochStartTimeSec(priceEpochId + 2);

    // getLogger("IndexerClient").info(
    //   `Querying signatures for epoch ${priceEpochId}, time interval: ${start} - ${nextStart}`
    // );

    const txns: TLPTransaction[] = await this.entityManager.getRepository(TLPTransaction).find({
      where: {
        function_sig: this.encodingUtils().functionSignature("signResult").slice(2),
        timestamp: Between(start, nextStart - 1),
      },
    });

    const signatures = new Map<Address, [SignatureData, Timestamp]>();
    for (const tx of txns) {
      const sig = this.encodingUtils().extractSignatureData(toTxData(tx));
      // getLogger("IndexerClient").info(`Got signature ${tx.from} - ${sig.merkleRoot}`);
      signatures.set("0x" + tx.from_address.toLowerCase(), [sig, tx.timestamp]);
    }

    if ((await this.getMaxTimestamp()) > nextStart) {
      this.cache.priceEpochSignatures.set(priceEpochId, signatures);
    }

    return signatures;
  }

  async queryFinalize(priceEpochId: PriceEpochId): Promise<[FinalizeData, Timestamp] | undefined> {
    const cached = this.cache.priceEpochFinalizes.get(priceEpochId);
    if (cached) return cached;

    const start = this.epochs.priceEpochStartTimeSec(priceEpochId + 1);
    const nextStart = this.epochs.priceEpochStartTimeSec(priceEpochId + 2);

    const tx = await this.entityManager.getRepository(TLPTransaction).findOne({
      where: {
        function_sig: this.encodingUtils().functionSignature("finalize").slice(2),
        timestamp: Between(start, nextStart - 1),
        status: 1,
      },
    });

    if (tx === null) {
      return undefined;
    }

    const f = this.encodingUtils().extractFinalize(toTxData(tx));
    // getLogger("IndexerClient").info(`Got finalize ${tx.from} - ${f.epochId}`);
    this.cache.priceEpochFinalizes.set(priceEpochId, [f, tx.timestamp]);
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
    // const cached = this.cache.rewardEpochOffers.get(rewardEpochId);
    // if (cached) return cached;

    const start = this.epochs.priceEpochStartTimeSec(this.epochs.firstPriceEpochForRewardEpoch(rewardEpochId - 1));
    const nextStart = this.epochs.priceEpochStartTimeSec(
      this.epochs.lastPriceEpochForRewardEpoch(rewardEpochId - 1) + 1
    );

    const txns = await this.entityManager.getRepository(TLPTransaction).find({
      where: {
        function_sig: this.encodingUtils().functionSignature("offerRewards").slice(2),
        timestamp: Between(start, nextStart - 1),
        status: 1,
      },
      relations: ["TPLEvents_set"],
    });

    const rewardOffers: RewardOffered[] = [];
    for (const tx of txns) {
      const logs1 = tx.TPLEvents_set;
      logs1.forEach(log => {
        log.topic0;
      });

      const events = tx.TPLEvents_set;
      const offers = this.encodingUtils().extractOffers(events);
      // console.log(`Got reward offers ${tx.from_address} - ${offers.length}`);
      rewardOffers.push(...offers);
    }

    this.cache.rewardEpochOffers.set(rewardEpochId, rewardOffers);

    return rewardOffers;
  }
}
