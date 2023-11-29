import BN from "bn.js";
import _ from "lodash";

import { EpochSettings } from "./utils/EpochSettings";
import {
  calculateEpochResult,
  calculateFeedMedians,
  calculateResultsForFeed,
  rewardEpochFeedSequence,
} from "./price-calculation";
import { IPriceProvider } from "./IPriceFeed";
import { IVotingProvider } from "./IVotingProvider";
import {
  EpochData,
  EpochResult,
  FinalizeData,
  MedianCalculationResult,
  RevealResult,
  RewardOffered,
  Feed,
  RewardClaim,
  Address,
} from "./voting-types";
import {
  ZERO_BYTES32,
  feedId,
  hashForCommit,
  packPrices,
  toBN,
  parsePrices,
  combineRandom,
} from "./utils/voting-utils";
import { Bytes32 } from "./utils/sol-types";
import { asError } from "./utils/error";
import { RewardLogic } from "./RewardLogic";
import { BlockIndex } from "./BlockIndex";
import { ILogger } from "./utils/ILogger";
import { SubProtocol } from "../TopLevelRunner";
import { IndexerClient } from "./IndexerClient";

const DEFAULT_VOTER_WEIGHT = 1000;
const NON_EXISTENT_PRICE = 0;

/**
 * A generic class for FTSO client implementation.
 * It supports pluggable price feeds and voting providers (Truffle for testing, Web3 for production).
 */
export class FTSOClient implements SubProtocol {
  private readonly priceProvidersByFeed = new Map<string, IPriceProvider>();

  get address() {
    return this.provider.senderAddressLowercase;
  }

  constructor(
    private readonly provider: IVotingProvider,
    private readonly index: IndexerClient,
    private readonly epochs: EpochSettings,
    priceProviders: IPriceProvider[] = [],
    private readonly logger: ILogger
  ) {
    this.registerPriceProviders(priceProviders);
  }

  // SubProtocol implementation
  readonly protocolId: number = 100;

  private lastEpochData: EpochData | undefined;

  async getCommit(epochId: number): Promise<string> {
    const data = await this.getPricesForEpoch(epochId);
    const hash = hashForCommit(this.address, data.random.value, data.merkleRoot, data.pricesHex);
    this.lastEpochData = data;
    return Promise.resolve(hash);
  }

  async getReveal(epochId: number): Promise<EpochData | undefined> {
    return Promise.resolve(this.lastEpochData);
  }

  async getResultAfterDeadline(epochId: number, deadlineSec: number): Promise<string> {
    await this.index.awaitLaterBlock(deadlineSec);
    const result = await this.calculateResults(epochId);
    return result.merkleRoot.value;
  }
  // End SubProtocol implementation

  private registerPriceProviders(priceProviders: IPriceProvider[]) {
    for (const priceProvier of priceProviders) {
      this.priceProvidersByFeed.set(feedId(priceProvier.getFeedInfo()), priceProvier);
    }
  }

  /**
   * Placeholder for registering as a voter with a default constant weight.
   * To be replaced with a proper mechanism.
   */
  async registerAsVoter(rewardEpochId: number): Promise<void> {
    this.logger.info(`Registering as a voter for reward epoch ${rewardEpochId}`);
    try {
      await this.provider.registerAsVoter(rewardEpochId, DEFAULT_VOTER_WEIGHT);
    } catch (e) {
      const error = asError(e);
      if (error.message.includes("already registered")) {
        this.logger.info(`Already registered as a voter for reward epoch ${rewardEpochId}`);
      } else {
        throw error;
      }
    }
    this.logger.info(`Done registering as a voter for reward epoch ${rewardEpochId}`);
  }

  async commit(data: EpochData) {
    const hash = hashForCommit(this.address, data.random.value, data.merkleRoot, data.pricesHex);
    this.logger.info(`Committing to price epoch ${data.epochId} with hash ${hash}`);
    await this.provider.commit(hash);
  }

  async reveal(data: EpochData) {
    await this.provider.revealBitvote(data);
  }

  async signResult(priceEpochId: number, result: string): Promise<void> {
    const signature = await this.provider.signMessage(result);
    await this.provider.signResult(priceEpochId, result, {
      v: signature.v,
      r: signature.r,
      s: signature.s,
    });
  }

  async calculateResults(priceEpochId: number): Promise<EpochResult> {
    const rewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);
    const voterWeights = await this.provider.getVoterWeightsForRewardEpoch(rewardEpoch);

    const revealResult = await this.calculateRevealers(priceEpochId, voterWeights)!;
    if (revealResult.revealers.length === 0) {
      throw new Error(`No reveals for price epoch: ${priceEpochId}.`);
    }

    const results: MedianCalculationResult[] = await calculateFeedMedians(
      revealResult,
      voterWeights,
      await this.index.getRewardOffers(rewardEpoch)
    );

    const random: [Bytes32, number] = [
      combineRandom(revealResult.revealedRandoms),
      revealResult.committedFailedReveal.length,
    ];
    return calculateEpochResult(results, random, priceEpochId);
  }

  async calculateRevealers(priceEpochId: number, voterWeights: Map<Address, BN>): Promise<RevealResult> {
    const commits = await this.index.queryCommits(priceEpochId);
    const reveals = await this.index.queryReveals(priceEpochId);
    // this.logger.info(`Calculating reveals for price epoch ${priceEpochId}: ${[reveals.keys().]} keys for reveals, }`);
    const committers = [...commits.keys()];
    const eligibleCommitters = committers
      .map(sender => sender.toLowerCase())
      .filter(voter => voterWeights.has(voter.toLowerCase())!);

    const failedCommit = _.difference(eligibleCommitters, committers);
    if (failedCommit.length > 0) {
      this.logger.info(`Not seen commits from ${failedCommit.length} voters: ${failedCommit}`);
    }

    const [revealed, committedFailedReveal] = _.partition(eligibleCommitters, committer => {
      const revealData = reveals.get(committer);
      if (!revealData) {
        return false;
      }
      const commitHash = commits.get(committer);
      return commitHash === hashForCommit(committer, revealData.random, revealData.merkleRoot, revealData.prices);
    });

    if (committedFailedReveal.length > 0) {
      this.logger.info(`Not seen reveals from ${committedFailedReveal.length} voters: ${committedFailedReveal}`);
    }

    const revealedRandoms = revealed.map(voter => {
      const rawRandom = reveals!.get(voter.toLowerCase())!.random;
      return Bytes32.fromHexString(rawRandom);
    });
    const result: RevealResult = {
      revealers: revealed,
      committedFailedReveal,
      revealedRandoms,
      reveals,
    };
    return result;
  }

  async calculateRewards(priceEpochId: number, rewardOffers: RewardOffered[]): Promise<RewardClaim[]> {
    const rewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);
    const voterWeights = await this.provider.getVoterWeightsForRewardEpoch(rewardEpoch);

    const revealResult = await this.calculateRevealers(priceEpochId, voterWeights)!;
    if (revealResult.revealers.length === 0) {
      throw new Error(`No reveals for for price epoch: ${priceEpochId}.`);
    }

    const medianResults: MedianCalculationResult[] = await calculateFeedMedians(
      revealResult,
      voterWeights,
      rewardOffers
    );
    const committedFailedReveal = revealResult.committedFailedReveal;

    const finalizationData = await this.index.queryFinalize(priceEpochId - 1);
    let rewardedSigners: string[] = [];

    if (finalizationData !== undefined) {
      rewardedSigners = await this.getSignersToReward(finalizationData, priceEpochId, voterWeights);
    } else {
      const wasFinalized = (await this.provider.getMerkleRoot(priceEpochId - 1)) !== ZERO_BYTES32;
      if (wasFinalized) {
        // TODO: Add tests for this scenario
        throw Error(`Previous epoch ${priceEpochId - 1} was finalized, but we've not observed the finalization.\n 
                     Aborting since we won't be able to compute cumulative reward claims correctly.`);
      }
    }

    return RewardLogic.calculateClaimsForPriceEpoch(
      rewardOffers,
      priceEpochId,
      finalizationData?.[0].from,
      rewardedSigners,
      medianResults,
      committedFailedReveal,
      voterWeights,
      this.epochs
    );
  }

  /**
   * We reward signers whose signatures were recorded in blocks preceding the finalization transaction block.
   * Note that the sender of a signature transaction may not match the author of that signature. We only want
   * to reward the author (signer).
   */
  private async getSignersToReward(
    finalizationData: [FinalizeData, number],
    priceEpochId: number,
    voterWeights: Map<string, BN>
  ): Promise<string[]> {
    const rewardedSigners = new Set<string>();
    const [data, finalizationTime] = finalizationData;

    const currentEpochStartTime = this.epochs.priceEpochStartTimeSec(priceEpochId + 1);
    if (finalizationTime >= currentEpochStartTime) {
      this.logger.info(
        `Previous epoch ${data.epochId} finalization occured outside the price epoch window (at ${new Date(
          finalizationTime * 1000
        ).toUTCString()} vs next epoch start time ${new Date(
          currentEpochStartTime * 1000
        ).toUTCString()}), no signers will be rewarded.`
      );
      return [];
    }

    const epochSignatures = await this.index.querySignatures(priceEpochId - 1);
    for (const [signature, signatureTime] of epochSignatures.values()) {
      if (signatureTime > finalizationTime) continue; // Only reward signatures with block timestamp no greater than that of finalization
      const signer = await this.provider.recoverSigner(data.merkleRoot, signature);
      // We check if the signer is registered for the _current_ reward epoch, the signature reward epoch might be one earlier.
      const signerWeight = voterWeights.get(signer);
      if (signerWeight && signerWeight.gt(toBN(0))) {
        rewardedSigners.add(signer);
      }
    }
    return Array.from(rewardedSigners);
  }

  async getPriceProviders(priceEpochId: number): Promise<(IPriceProvider | undefined)[]> {
    const rewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);
    return rewardEpochFeedSequence(await this.index.getRewardOffers(rewardEpoch)).map(feed =>
      this.priceProvidersByFeed.get(feedId(feed))
    );
  }

  async getPricesForEpoch(priceEpochId: number): Promise<EpochData> {
    if (this.priceProvidersByFeed.size === 0) throw new Error("No price feeds registered.");

    const prices = (await this.getPriceProviders(priceEpochId)).map(priceFeed =>
      priceFeed ? priceFeed.getPriceForEpoch(priceEpochId) : NON_EXISTENT_PRICE
    );
    const data: EpochData = {
      epochId: priceEpochId,
      merkleRoot: ZERO_BYTES32,
      prices: prices,
      pricesHex: packPrices(prices),
      random: Bytes32.random(),
      bitVote: "0x00",
    };
    return data;
  }

  async publishPrices(prices: EpochResult, symbolIndices: number[]) {
    this.logger.info(`Publishing ${prices.medianData.length} prices for price epoch ${prices.priceEpochId}.`);
    return await this.provider.publishPrices(prices, symbolIndices);
  }
}
