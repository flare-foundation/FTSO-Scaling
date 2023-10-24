import BN from "bn.js";
import _ from "lodash";

import { EpochSettings } from "./protocol/utils/EpochSettings";
import { calculateEpochResult, calculateResultsForFeed } from "./protocol/price-calculation";
import { IPriceFeed } from "./price-feeds/IPriceFeed";
import { IVotingProvider } from "./providers/IVotingProvider";
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
} from "./protocol/voting-types";
import {
  ZERO_BYTES32,
  feedId,
  hashForCommit,
  packPrices,
  toBN,
  parsePrices,
  combineRandom,
} from "./protocol/utils/voting-utils";
import { getLogger } from "./utils/logger";
import { Bytes32 } from "./protocol/utils/sol-types";
import { asError } from "./utils/error";
import { RewardLogic } from "./protocol/RewardLogic";
import { BlockIndex } from "./BlockIndex";

const DEFAULT_VOTER_WEIGHT = 1000;
const NON_EXISTENT_PRICE = 0;

/**
 * A generic class for FTSO client implementation.
 * It supports pluggable price feeds and voting providers (Truffle for testing, Web3 for production).
 */
export class FTSOClient {
  private readonly logger = getLogger(FTSOClient.name);
  private readonly priceFeedsById = new Map<string, IPriceFeed>();

  get address() {
    return this.provider.senderAddressLowercase;
  }

  constructor(
    private readonly provider: IVotingProvider,
    private readonly index: BlockIndex,
    private readonly epochs: EpochSettings,
    priceFeeds: IPriceFeed[] = []
  ) {
    this.registerPriceFeeds(priceFeeds);
  }

  private registerPriceFeeds(priceFeeds: IPriceFeed[]) {
    for (const priceFeed of priceFeeds) {
      this.priceFeedsById.set(feedId(priceFeed.getFeedInfo()), priceFeed);
    }
  }

  /**
   * Placeholder for registering as a voter with a default constant weight.
   * To be replaced with a proper mechanisnm.
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
    await this.provider.commit(hash);
  }

  async reveal(data: EpochData) {
    await this.provider.revealBitvote(data);
  }

  async calculateResultsAndSign(priceEpochId: number): Promise<EpochResult> {
    const result = await this.calculateResults(priceEpochId);
    const signature = await this.provider.signMessage(result.merkleRoot.value);
    await this.provider.signResult(priceEpochId, result.merkleRoot.value, {
      v: signature.v,
      r: signature.r,
      s: signature.s,
    });
    return result;
  }

  async calculateResults(priceEpochId: number) {
    const rewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);
    const voterWeights = await this.provider.getVoterWeightsForRewardEpoch(rewardEpoch);

    const revealResult = await this.calculateRevealers(priceEpochId, voterWeights)!;
    if (revealResult.revealers.length === 0) {
      throw new Error(`No reveals for price epoch: ${priceEpochId}.`);
    }

    const results: MedianCalculationResult[] = await this.calculateFeedMedians(
      priceEpochId,
      revealResult,
      voterWeights
    );

    const random: [Bytes32, number] = [
      combineRandom(revealResult.revealedRandoms),
      revealResult.committedFailedReveal.length,
    ];
    return calculateEpochResult(results, random, priceEpochId);
  }

  async calculateRevealers(priceEpochId: number, voterWeights: Map<Address, BN>): Promise<RevealResult> {
    const commits = this.index.getCommits(priceEpochId);
    const reveals = this.index.getReveals(priceEpochId);
    const eligibleCommitters = [...commits.keys()]
      .map(sender => sender.toLowerCase())
      .filter(voter => voterWeights.has(voter.toLowerCase())!);

    const [revealed, committedFailedReveal] = _.partition(eligibleCommitters, committer => {
      const revealData = reveals.get(committer);
      if (!revealData) {
        return false;
      }
      const commitHash = commits.get(committer);
      return commitHash === hashForCommit(committer, revealData.random, revealData.merkleRoot, revealData.prices);
    });
    const revealedRandoms = revealed.map(voter => {
      const rawRandom = reveals!.get(voter.toLowerCase())!.random;
      return Bytes32.fromHexString(rawRandom);
    });
    const result: RevealResult = {
      revealers: revealed,
      committedFailedReveal,
      revealedRandoms,
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

    const medianResults: MedianCalculationResult[] = await this.calculateFeedMedians(
      priceEpochId,
      revealResult,
      voterWeights
    );
    const committedFailedReveal = revealResult.committedFailedReveal;

    const finalizationData = this.index.getFinalize(priceEpochId - 1);
    let rewardedSigners: string[] = [];

    if (finalizationData !== undefined) {
      rewardedSigners = await this.getSignersToReward(finalizationData, priceEpochId, voterWeights);
    } else {
      const wasFinalized = (await this.provider.getMerkleRoot(priceEpochId - 1)) !== ZERO_BYTES32;
      if (wasFinalized) {
        // TODO: Add tests for this scenario
        throw Error(`Previous epoch ${priceEpochId - 1} was finalized, but we've not observed the finalization.\ 
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

    const epochSignatures = this.index.getSignatures(priceEpochId - 1);
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

  orderedPriceFeeds(priceEpochId: number): (IPriceFeed | undefined)[] {
    const rewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);
    return RewardLogic.feedSequenceByOfferValue(this.index.getRewardOffers(rewardEpoch)).map(feed =>
      this.priceFeedsById.get(feedId(feed))
    );
  }

  getPricesForEpoch(priceEpochId: number): EpochData {
    if (this.priceFeedsById.size === 0) throw new Error("No price feeds registered.");

    const prices = this.orderedPriceFeeds(priceEpochId).map(priceFeed =>
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
    this.logger.info(`Publishing prices for price epoch ${prices.priceEpochId}.`);
    return await this.provider.publishPrices(prices, symbolIndices);
  }

  private async calculateFeedMedians(
    priceEpochId: number,
    revealResult: RevealResult,
    voterWeights: Map<Address, BN>
  ): Promise<MedianCalculationResult[]> {
    const rewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);
    const orderedPriceFeeds: Feed[] = RewardLogic.feedSequenceByOfferValue(this.index.getRewardOffers(rewardEpoch));
    const numberOfFeeds = orderedPriceFeeds.length;
    const voters = revealResult.revealers;
    const weights = voters.map(voter => voterWeights.get(voter.toLowerCase())!);

    const feedPrices: BN[][] = orderedPriceFeeds.map(() => new Array<BN>());
    voters.forEach(voter => {
      const revealData = this.index.getReveals(priceEpochId)!.get(voter.toLowerCase())!;
      let voterPrices = parsePrices(revealData.prices, numberOfFeeds);
      voterPrices.forEach((price, i) => feedPrices[i].push(price));
    });

    return orderedPriceFeeds.map((feed, i) => calculateResultsForFeed(voters, feedPrices[i], weights, feed));
  }
}
