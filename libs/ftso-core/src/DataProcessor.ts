import { Between, EntityManager, MoreThan } from "typeorm";
import { TLPEvents, TLPState, TLPTransaction } from "./orm/entities";
import { EpochSettings } from "./utils/EpochSettings";
import {
  Address,
  FinalizeData,
  RevealData,
  RewardEpochId,
  SignatureData,
  TxData,
  VotingEpochId
} from "./voting-types";

import Web3 from "web3";
import { InflationRewardsOffered, RewardsOffered, VoterRegistered } from "./events";
import { ISigningPolicy } from "./utils/SigningPolicy";


declare type CommitHash = string;
declare type Timestamp = number;

const REWARD_VALUE = 10_000;
const IQR_SHARE = 700_000;
const PCT_SHARE = 300_000;
const ELASTIC_BAND_WIDTH_PPM = 50_000;
const DEFAULT_REWARD_BELT_PPM = 500_000;

// 
// For given rewardEpochId:
// - start of reward offers
//    - ["FlareSystemManager", undefined, "RewardEpochStarted"], for rewardEpochId - 1
// - end of reward offers
//    - ["FlareSystemManager", undefined, "RandomAcquisitionStarted"],
// - reward offers 
//    - ["FtsoRewardOffersManager", undefined, "InflationRewardsOffered"],
//    - ["FtsoRewardOffersManager", undefined, "RewardsOffered"],
// - start of voter registration ["FlareSystemManager", undefined, "VotePowerBlockSelected"],
// - end of voter registration and signing policy ["Relay", undefined, "SigningPolicyInitialized"],
// - all voter registration events and related in info events:
//    - ["VoterRegistry", undefined, "VoterRegistered"],
//    - ["FlareSystemCalculator", undefined, "VoterRegistrationInfo"],




// All these events should be available before 

class DBCache {
  readonly votingRoundCommits = new Map<VotingEpochId, Map<Address, CommitHash>>();
  readonly votingRoundReveals = new Map<VotingEpochId, Map<Address, RevealData>>();
  readonly votingRoundSignatures = new Map<VotingEpochId, Map<Address, [SignatureData, Timestamp]>>();
  readonly voti8ngRoundFinalizations = new Map<VotingEpochId, [FinalizeData, Timestamp]>();
  readonly rewardSignatures = new Map<RewardEpochId, Map<Address, [SignatureData, Timestamp]>>();
  readonly rewardFinalizes = new Map<RewardEpochId, [FinalizeData, Timestamp]>();
  readonly rewardEpochOffers = new Map<RewardEpochId, RewardsOffered[]>();
  readonly inflationRewardEpochOffers = new Map<RewardEpochId, InflationRewardsOffered[]>();
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

export class DataProcessor {

  private readonly cache = new DBCache();

  protected readonly encodingUtils = () => EncodingUtils.instance;
  readonly signingPolicyTopic = this.encodingUtils().eventSignature("SigningPolicyInitialized").slice(2);
  readonly voterRegisteredTopic = this.encodingUtils().eventSignature("VoterRegistered").slice(2);

  constructor(private readonly entityManager: EntityManager, protected readonly epochs: EpochSettings) { }




  // TODO: query by name
  async getMaxTimestamp(): Promise<number> {
    const state = await this.entityManager.getRepository(TLPState).findOneBy({ name: "last_chain_block" });
    return state!.block_timestamp;
  }

  commitSelector = Web3.utils.sha3("submit1()")!.slice(2, 10);
  revealSelector = Web3.utils.sha3("submit2()")!.slice(2, 10);

  async queryCommits(votingRoundId: VotingEpochId): Promise<Map<Address, CommitHash>> {
    const start = this.epochs.votingEpochStartMs(votingRoundId);
    const nextStart = this.epochs.votingEpochStartMs(votingRoundId + 1);

    const max = await this.getMaxTimestamp();
    console.log(`Max timestamp ${max}`);
    // if (max < nextStart) {
    //   throw new Error(`Incomplete commit picture for current price epoch: ${max} < ${nextStart}}`);
    // }

    console.log(
      `Start: ${new Date(start).toISOString()}, nextStart: ${new Date(
        nextStart
      ).toISOString()}, in sec: start: ${start}, nextStart: ${nextStart}`
    );
    console.log("Commit selector: ", this.commitSelector);
    const txns: TLPTransaction[] = await this.entityManager.getRepository(TLPTransaction).find({
      where: {
        function_sig: this.commitSelector,
        timestamp: Between(start / 1000, nextStart / 1000 - 1),
      },
    });

    const epochCommits = new Map<Address, CommitHash>();
    for (const tx of txns) {
      const extractedCommit = this.encodingUtils().extractCommitHash(tx.input);
      console.log(`Got commit response ${tx.from_address} - ${extractedCommit}`);
      const signingAddress = await this.getSigningAddress(votingRoundId, "0x" + tx.from_address);
      epochCommits.set(signingAddress, extractedCommit);
    }

    return epochCommits;
  }

  async getSigningAddress(votingEpochId: number, submitAddress: string): Promise<Address> {
    const rewardEpochId = this.epochs.expectedRewardEpochForVotingEpoch(votingEpochId);
    const voterRegistrations = await this.getVoterRegistrations(rewardEpochId);

    const reg = voterRegistrations.find(reg => reg.submitAddress.toLowerCase() === submitAddress.toLowerCase());
    return reg.signingPolicyAddress.toLowerCase();
  }

  async getRevealWithholders(votingEpochId: number): Promise<Set<Address>> {
    // TODO: implement query
    return new Set<Address>();
  }

  async queryReveals(votingRoundId: VotingEpochId): Promise<Map<Address, RevealData>> {
    const start = this.epochs.votingEpochStartMs(votingRoundId + 1);
    const revealDeadline = this.epochs.revealDeadlineSec(votingRoundId + 1);

    const max = await this.getMaxTimestamp();
    // if (max < revealDeadline) {
    //   throw new Error(`Incomplete reveal picture for current price epoch`);
    // }
    console.log("Reveal selector: ", this.revealSelector);
    console.log(`Start (${votingRoundId + 1}): ${start / 1000}, deadline: ${revealDeadline / 1000}`);

    const txns: TLPTransaction[] = await this.entityManager.getRepository(TLPTransaction).find({
      where: {
        function_sig: this.revealSelector,
        timestamp: Between(start / 1000, revealDeadline / 1000),
      },
    });

    const epochReveals = new Map<Address, RevealData>();
    for (const tx of txns) {
      const reveal = this.encodingUtils().extractReveal(tx.input);
      console.log(`Got reveal response ${tx.from_address} - ${reveal}`);
      const signingAddress = await this.getSigningAddress(votingRoundId, "0x" + tx.from_address);
      epochReveals.set(signingAddress, reveal);
    }

    return epochReveals;
  }

  async querySignatures(votingRoundId: VotingEpochId): Promise<Map<Address, [SignatureData, Timestamp]>> {
    const cached = this.cache.votingRoundSignatures.get(votingRoundId);
    if (cached) {
      // getLogger("IndexerClient").info(`Got cached signatures for epoch ${votingRoundId}`);
      return cached;
    }

    const start = this.epochs.votingEpochStartMs(votingRoundId + 1);
    const nextStart = this.epochs.votingEpochStartMs(votingRoundId + 2);

    // getLogger("IndexerClient").info(
    //   `Querying signatures for epoch ${votingRoundId}, time interval: ${start} - ${nextStart}`
    // );

    const txns: TLPTransaction[] = await this.entityManager.getRepository(TLPTransaction).find({
      where: {
        function_sig: Web3.utils.sha3("sign()")!.slice(2, 10),
        timestamp: Between(start / 1000, nextStart / 1000 - 1),
      },
    });

    const signatures = new Map<Address, [SignatureData, Timestamp]>();
    for (const tx of txns) {
      const sig = this.encodingUtils().extractSignatures(toTxData(tx));
      // getLogger("IndexerClient").info(`Got signature ${tx.from} - ${sig.merkleRoot}`);
      signatures.set("0x" + tx.from_address.toLowerCase(), [sig, tx.timestamp]);
    }

    if ((await this.getMaxTimestamp()) > nextStart) {
      this.cache.votingRoundSignatures.set(votingRoundId, signatures);
    }

    return signatures;
  }

  // async queryFinalize(priceEpochId: PriceEpochId): Promise<[FinalizeData, Timestamp] | undefined> {
  //   const cached = this.cache.priceEpochFinalizes.get(priceEpochId);
  //   if (cached) return cached;

  //   const start = this.epochs.priceEpochStartTimeSec(priceEpochId + 1);
  //   const nextStart = this.epochs.priceEpochStartTimeSec(priceEpochId + 2);

  //   const tx = await this.entityManager.getRepository(TLPTransaction).findOne({
  //     where: {
  //       function_sig: this.encodingUtils().functionSignature("finalize").slice(2),
  //       timestamp: Between(start, nextStart - 1),
  //       status: 1,
  //     },
  //   });

  //   if (tx === null) {
  //     return undefined;
  //   }

  //   const f = this.encodingUtils().extractFinalize(toTxData(tx));
  //   // getLogger("IndexerClient").info(`Got finalize ${tx.from} - ${f.epochId}`);
  //   this.cache.priceEpochFinalizes.set(priceEpochId, [f, tx.timestamp]);
  //   return [f, tx.timestamp];
  // }

  async getVoterWeights(votingEpochId: number): Promise<Map<Address, bigint>> {
    // TODO: calculate the reward epoch id based on the real reward epochs
    const rewardEpochId = this.epochs.expectedRewardEpochForVotingEpoch(votingEpochId);
    const signingPolicy = await this.getSigningPolicy(rewardEpochId);

    const voterWeights = new Map<Address, bigint>();
    const voters = signingPolicy.voters;
    // TODO: these are wrong weights. Should be obtained form voter registration event
    const weights = signingPolicy.weights;
    for (let i = 0; i < voters.length; i++) {
      voterWeights.set(voters[i]!.toLowerCase(), BigInt(weights[i]));
    }
    return voterWeights;
  }

  async getVoterRegistrations(rewardEpochId: number): Promise<VoterRegistered[]> {
    const cached = this.voterRegistrations.get(rewardEpochId);
    if (cached !== undefined) return cached;

    const previousRewardEpochStartSec = this.epochs.expectedFirstVotingRoundForRewardEpoch(rewardEpochId - 1) / 1000;

    console.log("Topic for VoterRegistered", this.voterRegisteredTopic);
    const events = await this.entityManager.getRepository(TLPEvents).find({
      where: {
        topic0: this.voterRegisteredTopic,
        timestamp: MoreThan(previousRewardEpochStartSec),
      },
    });

    const res = this.encodingUtils().extractVoterRegistration(events);
    const parsed = res.filter(x => x.rewardEpochId === rewardEpochId);
    this.voterRegistrations.set(rewardEpochId, parsed);
    return parsed;
  }

  readonly signingPolicies = new Map<RewardEpochId, ISigningPolicy>();
  readonly voterRegistrations = new Map<RewardEpochId, VoterRegistered[]>();

  async getSigningPolicy(rewardEpochId: number): Promise<ISigningPolicy> {
    const cached = this.signingPolicies.get(rewardEpochId);
    if (cached !== undefined) return cached;

    const previousRewardEpochStartSec = this.epochs.expectedFirstVotingRoundForRewardEpoch(rewardEpochId - 1) / 1000;

    const events = await this.entityManager.getRepository(TLPEvents).find({
      where: {
        topic0: this.signingPolicyTopic,
        timestamp: MoreThan(previousRewardEpochStartSec),
      },
    });

    const res = this.encodingUtils().extractSigningPolicies(events);
    const policy = res.filter(x => x.rewardEpochId === rewardEpochId)[0];

    this.signingPolicies.set(rewardEpochId, policy);

    return policy;
  }

  // TODO: Get real offers
  // async getRewardOffers(rewardEpochId: RewardEpochId): Promise<RewardOffers> {
  //   const rewardOffers = await this._getRewardOffers(rewardEpochId);
  //   const inflationOffers = await this._getInflationRewardOffers(rewardEpochId);
  //   return {
  //     rewardOffers,
  //     inflationOffers,
  //   };
  // }

  // async _getRewardOffers(rewardEpochId: RewardEpochId): Promise<RewardsOffered[]> {
  //   // TODO: query indexer
  //   const offers: RewardsOffered[] = [
  //     {
  //       rewardEpochId: 0,
  //       feedName: "0x4141504C00000000", // AAPL
  //       decimals: 8,
  //       amount: BigInt("100000000000000000000"),
  //       primaryBandRewardSharePPM: 200000, // 20%
  //       secondaryBandWidthPPM: 50000, // 5%
  //       rewardEligibilityPPM: 100000, // 10%
  //       leadProviders: [],
  //       claimBackAddress: "0x0000000",
  //     },
  //     {
  //       rewardEpochId: 0,
  //       feedName: "0x474F4C4455534400", // GOLDUSD
  //       decimals: 8,
  //       amount: BigInt("100000000000000000000"),
  //       primaryBandRewardSharePPM: 300000, // 20%
  //       secondaryBandWidthPPM: 20000, // 5%
  //       rewardEligibilityPPM: 100000, // 10%
  //       leadProviders: [],
  //       claimBackAddress: "0x0000000",
  //     },
  //   ];

  //   return offers;
  // }

  // async _getInflationRewardOffers(rewardEpochId: RewardEpochId): Promise<InflationRewardsOffered[]> {
  //   // TODO: query indexer

  //   const supportedFeeds = [
  //     "0x4254430055534454", // BTC USDT
  //     "0x4554480055534454", // ETH USDT
  //     "0x464c520055534454", // FLR USDT
  //     "0x444f474555534454", // DOGEUSDT
  //   ];

  //   const offers: InflationRewardsOffered[] = [
  //     {
  //       rewardEpochId: 0,
  //       feedNames: supportedFeeds,
  //       decimals: 8,
  //       amount: BigInt("100000000000000000000"),
  //       mode: 0,
  //       primaryBandRewardSharePPM: 200000, // 20%
  //       secondaryBandWidthPPMs: [20000, 50000, 70000, 90000], // 2% 5% 7% 9%
  //     },
  //   ];

  //   return offers;

  // const cached = this.cache.rewardEpochOffers.get(rewardEpochId);
  // if (cached) return cached;

  // const start = this.epochs.priceEpochStartTimeSec(this.epochs.firstPriceEpochForRewardEpoch(rewardEpochId - 1));
  // const nextStart = this.epochs.priceEpochStartTimeSec(
  //   this.epochs.lastPriceEpochForRewardEpoch(rewardEpochId - 1) + 1
  // );

  // const txns = await this.entityManager.getRepository(TLPTransaction).find({
  //   where: {
  //     function_sig: this.encodingUtils().functionSignature("offerRewards").slice(2),
  //     timestamp: Between(start, nextStart - 1),
  //     status: 1,
  //   },
  //   relations: ["TPLEvents_set"],
  // });

  // const rewardOffers: RewardOffered[] = [];
  // for (const tx of txns) {
  //   const logs1 = tx.TPLEvents_set;
  //   logs1.forEach(log => {
  //     log.topic0;
  //   });

  //   const events = tx.TPLEvents_set;
  //   const offers = this.encodingUtils().extractOffers(events);
  //   // console.log(`Got reward offers ${tx.from_address} - ${offers.length}`);
  //   rewardOffers.push(...offers);
  // }

  // const max = await this.getMaxTimestamp();
  // if (max > nextStart) {
  //   this.cache.rewardEpochOffers.set(rewardEpochId, rewardOffers);
  // }
  // return rewardOffers;
  // }
}
