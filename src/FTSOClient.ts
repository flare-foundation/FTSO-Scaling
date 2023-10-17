import BN from "bn.js";
import Web3 from "web3";

import { EpochSettings } from "./EpochSettings";
import { calculateResultsForFeed } from "./protocol/median-calculation";
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
} from "./protocol/voting-types";
import {
  ZERO_BYTES32,
  feedId,
  hashForCommit,
  packPrices,
  toBN,
  unprefixedSymbolBytes,
  combineRandom,
} from "./protocol/voting-utils";
import { getLogger } from "./utils/logger";
import { BlockIndex } from "./BlockIndex";
import { sleepFor } from "./utils/time";
import { Bytes32 } from "./protocol/sol-types";
import { asError } from "./utils/error";
import { BlockIndexer } from "./rewards/BlockIndexer";
import { RewardLogic } from "./protocol/RewardLogic";

const DEFAULT_VOTER_WEIGHT = 1000;
const EPOCH_BYTES = 4;
const PRICE_BYTES = 4;
const RANDOM_QUALITY_BYTES = 4;
const NON_EXISTENT_PRICE = 0;
const BLOCK_PROCESSING_INTERVAL_MS = 500;

function padEndArray(array: any[], minLength: number, fillValue: any = undefined) {
  return Object.assign(new Array(minLength).fill(fillValue), array);
}

/**
 * A generic class for FTSO client implementation.
 * It supports pluggable price feeds and voting providers (Truffle for testing, Web3 for production).
 */
export class FTSOClient {
  private readonly logger = getLogger(FTSOClient.name);
  private readonly voterWeight = DEFAULT_VOTER_WEIGHT;
  lastProcessedBlockNumber: number = 0;
  readonly epochs: EpochSettings;
  readonly index: BlockIndex;
  private readonly priceFeeds: Map<string, IPriceFeed> = new Map<string, IPriceFeed>();

  get address() {
    return this.provider.senderAddressLowercase;
  }

  constructor(public provider: IVotingProvider) {
    this.epochs = new EpochSettings(
      provider.firstEpochStartSec,
      provider.epochDurationSec,
      provider.firstRewardedPriceEpoch,
      provider.rewardEpochDurationInEpochs
    );
    this.index = new BlockIndexer(this.epochs, this.provider);
  }

  registerPriceFeeds(priceFeeds: IPriceFeed[]) {
    for (const priceFeed of priceFeeds) {
      this.priceFeeds.set(feedId(priceFeed.getFeedInfo()), priceFeed);
    }
  }

  /**
   * Placeholder for registering as a voter with a default constant weight.
   * To be replaced with a proper mechanisnm.
   */
  async registerAsVoter(rewardEpochId: number): Promise<void> {
    this.logger.info(`Registering as a voter for reward epoch ${rewardEpochId}`);
    try {
      await this.provider.registerAsVoter(rewardEpochId, this.voterWeight);
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

  async calculateResultsAndSign(priceEpochId: number) {
    const result = await this.calculateResults(priceEpochId);
    const signature = await this.provider.signMessage(result.merkleRoot);
    await this.provider.signResult(priceEpochId, result.merkleRoot, {
      v: signature.v,
      r: signature.r,
      s: signature.s,
    });
  }

  async calculateResults(priceEpochId: number) {
    const rewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);

    this.logger.info(
      `Reward epoch offer for ${priceEpochId} rewards: ${JSON.stringify(this.index.getRewardOffers(rewardEpoch))}`
    );

    const revealResult = await this.calculateRevealers(priceEpochId)!;
    if (revealResult.revealed.length === 0) {
      throw new Error(`No reveals for for price epoch: ${priceEpochId}.`);
    }

    const randomQuality = revealResult.committedFailedReveal.length;
    const combinedRandom = combineRandom(revealResult.revealedRandoms);

    const results: MedianCalculationResult[] = await this.calculateFeedMedians(priceEpochId, revealResult, rewardEpoch);
    let priceMessage = "";
    let symbolMessage = "";
    results.map(data => {
      priceMessage += Web3.utils.padLeft(data.data.finalMedianPrice.toString(16), PRICE_BYTES * 2);
      symbolMessage += unprefixedSymbolBytes(data.feed);
    });

    const randomMessage =
      Web3.utils.padLeft(randomQuality.toString(16), RANDOM_QUALITY_BYTES * 2) + combinedRandom.value.slice(2);
    const message =
      Web3.utils.padLeft(priceEpochId.toString(16), EPOCH_BYTES * 2) + priceMessage + symbolMessage + randomMessage;
    const priceMessageHash = Web3.utils.soliditySha3("0x" + message)!;

    const epochResult: EpochResult = {
      priceEpochId: priceEpochId,
      medianData: results,
      random: combinedRandom,
      randomQuality: randomQuality,
      priceMessage: "0x" + priceMessage,
      symbolMessage: "0x" + symbolMessage,
      randomMessage: "0x" + randomMessage,
      fullPriceMessage: "0x" + message,
      merkleRoot: priceMessageHash,
    };
    return epochResult;
  }

  async calculateRewards(priceEpochId: number, rewardOffers: RewardOffered[]): Promise<RewardClaim[]> {
    const rewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);

    const revealResult = await this.calculateRevealers(priceEpochId)!;
    if (revealResult.revealed.length === 0) {
      throw new Error(`No reveals for for price epoch: ${priceEpochId}.`);
    }

    const results: MedianCalculationResult[] = await this.calculateFeedMedians(priceEpochId, revealResult, rewardEpoch);
    const committedFailedReveal = revealResult.committedFailedReveal;

    const finalizationData = this.index.getFinalize(priceEpochId - 1);
    let rewardedSigners: string[] = [];

    if (finalizationData !== undefined) {
      rewardedSigners = await this.getSignersToReward(finalizationData, priceEpochId);
    } else {
      const wasFinalized = (await this.provider.getMerkleRoot(priceEpochId - 1)) !== ZERO_BYTES32;
      if (wasFinalized) {
        // TODO: Add tests for this scenario
        throw Error(`Previous epoch ${priceEpochId - 1} was finalized, but we've not observed the finalization.\ 
                     Aborting since we won't be able to compute cumulative reward claims correctly.`);
      }
    }

    const voterWeights = await this.provider.getVoterWeightsForRewardEpoch(rewardEpoch);

    return RewardLogic.calculateClaimsForPriceEpoch(
      rewardOffers,
      priceEpochId,
      finalizationData?.[0].from,
      rewardedSigners,
      results,
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
  private async getSignersToReward(finalizationData: [FinalizeData, number], priceEpochId: number): Promise<string[]> {
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
    const rewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);

    const epochSignatures = this.index.getSignatures(priceEpochId - 1);
    for (const [signature, signatureTime] of epochSignatures.values()) {
      if (signatureTime > finalizationTime) continue; // Only reward signatures with block timestamp no greater than that of finalization
      const signer = await this.provider.recoverSigner(data.merkleRoot, signature);
      // We check if the signer is registered for the _current_ reward epoch, the signature reward epoch might be one earlier.

      const signerWeight = (await this.provider.getVoterWeightsForRewardEpoch(rewardEpoch)).get(signer);
      if (signerWeight && signerWeight.gt(toBN(0))) {
        rewardedSigners.add(signer);
      }
    }
    return Array.from(rewardedSigners);
  }

  orderedPriceFeeds(priceEpochId: number): (IPriceFeed | undefined)[] {
    const rewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);
    return this.index.getFeedSequence(rewardEpoch).map(feed => this.priceFeeds.get(feedId(feed)));
  }

  orderedPriceFeedIds(priceEpochId: number): Feed[] {
    const rewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);
    return this.index.getFeedSequence(rewardEpoch);
  }

  getPricesForEpoch(priceEpochId: number): EpochData {
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
    return await this.provider.publishPrices(prices, symbolIndices);
  }

  private async calculateFeedMedians(
    priceEpochId: number,
    revealResult: RevealResult,
    rewardEpoch: number
  ): Promise<MedianCalculationResult[]> {
    const orderedPriceFeeds = this.orderedPriceFeedIds(priceEpochId);
    const numberOfFeeds = orderedPriceFeeds.length;
    const voters = revealResult.revealed;
    const voterWeights = await this.provider.getVoterWeightsForRewardEpoch(rewardEpoch);
    const weights = voters.map(voter => voterWeights.get(voter.toLowerCase())!);

    const feedPrices: BN[][] = orderedPriceFeeds.map(() => new Array<BN>());
    voters.forEach(voter => {
      const revealData = this.index.getReveals(priceEpochId)!.get(voter.toLowerCase())!;
      let feedPrice =
        revealData.prices
          .slice(2)
          .match(/(.{1,8})/g)
          ?.map(hex => parseInt(hex, 16)) || [];
      feedPrice = feedPrice.slice(0, numberOfFeeds);
      feedPrice = padEndArray(feedPrice, numberOfFeeds, 0);
      feedPrice.forEach((price, i) => feedPrices[i].push(toBN(price)));
    });

    return orderedPriceFeeds.map((feed, i) => calculateResultsForFeed(voters, feedPrices[i], weights, feed));
  }

  async awaitFinalization(priceEpochId: number) {
    while (!this.index.getFinalize(priceEpochId)) {
      this.logger.info(`Epoch ${priceEpochId} not finalized, keep processing new blocks`);
      await sleepFor(BLOCK_PROCESSING_INTERVAL_MS);
    }
    this.logger.info(`Epoch ${priceEpochId} finalized, continue.`);
  }

  // Encoding of signed result
  // [4 epochId][32-byte merkle root][4-byte price sequence]
  private async calculateRevealers(priceEpochId: number): Promise<RevealResult> {
    const rewardEpochId = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);
    const commits = this.index.getCommits(priceEpochId);
    const reveals = this.index.getReveals(priceEpochId);

    if (!commits || !reveals) {
      // TODO: check if this is correct
      throw new Error("Commits or reveals not found");
    }

    const voterWeights = await this.provider.getVoterWeightsForRewardEpoch(rewardEpochId);

    const eligibleCommitters = [...commits.keys()]
      .map(sender => sender.toLowerCase())
      .filter(voter => voterWeights.has(voter.toLowerCase())!);
    const revealed = eligibleCommitters.filter(sender => {
      const revealData = reveals!.get(sender);
      if (!revealData) {
        return false;
      }
      const commitHash = commits?.get(sender);
      return commitHash === hashForCommit(sender, revealData.random, revealData.merkleRoot, revealData.prices);
    });
    const failedCommit = [...voterWeights.keys()!].filter(voter => !revealed.includes(voter.toLowerCase()));
    const revealedSet = new Set<string>(revealed);
    const committedFailedReveal = eligibleCommitters.filter(voter => !revealedSet.has(voter.toLowerCase()));
    const revealedRandoms = revealed.map(voter => {
      const rawRandom = reveals!.get(voter.toLowerCase())!.random;
      return Bytes32.fromHexString(rawRandom);
    });
    const result: RevealResult = {
      revealed,
      failedCommit,
      committedFailedReveal,
      revealedRandoms,
    };
    return result;
  }
}
