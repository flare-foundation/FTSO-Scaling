import BN from "bn.js";
import Web3 from "web3";

import { EpochSettings } from "./EpochSettings";
import { MerkleTree } from "./MerkleTree";
import { RewardCalculator } from "./RewardCalculator";
import { calculateMedian } from "./median-calculation-utils";
import { IPriceFeed } from "./price-feeds/IPriceFeed";
import { IVotingProvider } from "./providers/IVotingProvider";
import {
  BareSignature,
  ClaimReward,
  EpochData,
  EpochResult,
  Feed,
  MedianCalculationResult,
  RevealResult,
  RewardOffered,
  SignatureData,
  VoterWithWeight,
} from "./voting-interfaces";
import {
  ZERO_BYTES32,
  feedId,
  hashClaimReward,
  hashForCommit,
  packPrices,
  sortedHashPair,
  toBN,
  unprefixedSymbolBytes,
} from "./voting-utils";
import { getLogger } from "./utils/logger";
import { BlockIndexer, Received } from "./BlockIndexer";
import { encodingUtils } from "./EncodingUtils";

const DEFAULT_VOTER_WEIGHT = 1000;
const EPOCH_BYTES = 4;
const PRICE_BYTES = 4;
const NON_EXISTENT_PRICE = 0;

function padEndArray(array: any[], minLength: number, fillValue: any = undefined) {
  return Object.assign(new Array(minLength).fill(fillValue), array);
}

/**
 * A generic class for FTSO client implementation.
 * It supports pluggable price feeds and voting providers (Truffle for testing, Web3 for production).
 */
export class FTSOClient {
  private readonly logger = getLogger(FTSOClient.name);

  rewardCalculator!: RewardCalculator;
  lastProcessedBlockNumber: number = 0;
  epochs: EpochSettings;

  readonly indexer: BlockIndexer;
  readonly priceEpochData = new Map<number, EpochData>();
  readonly priceEpochResults = new Map<number, EpochResult>();

  // reward epoch => voter => weight
  private eligibleVotersForRewardEpoch = new Map<number, VoterWithWeight[]>();
  private eligibleVoterWeights = new Map<number, Map<string, BN>>();
  private eligibleVoterTotalWeight = new Map<number, BN>();

  readonly rewardEpochOffers = new Map<number, RewardOffered[]>();
  private readonly rewardEpochOffersClosed = new Map<number, boolean>();
  private readonly priceFeeds: Map<string, IPriceFeed> = new Map<string, IPriceFeed>();

  private readonly signatureListener = (s: SignatureData) => this.onSignatureMaybeFinalize(s);

  get address() {
    return this.provider.senderAddressLowercase;
  }

  constructor(public provider: IVotingProvider, startBlockNumber: number) {
    this.epochs = new EpochSettings(
      provider.firstEpochStartSec,
      provider.epochDurationSec,
      provider.firstRewardedPriceEpoch,
      provider.rewardEpochDurationInEpochs
    );
    this.indexer = new BlockIndexer(this.epochs, this.provider.contractAddresses);
    this.indexer.on(Received.Offers, (pe: number, o: RewardOffered[]) => this.onRewardOffers(pe, o));

    this.lastProcessedBlockNumber = startBlockNumber - 1;
  }

  initializeRewardCalculator(initialRewardEpoch: number) {
    this.rewardCalculator = new RewardCalculator(this, initialRewardEpoch);
  }

  listenForSignatures() {
    this.indexer.on(Received.Signature, this.signatureListener);
  }

  clearSignatureListener() {
    try {
      this.indexer.off(Received.Signature, this.signatureListener);
    } catch (e) {
      // Ignore - listener was removed before calling finalize.
    }
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
  async registerAsVoter(rewardEpochId: number) {
    return await this.provider.registerAsVoter(rewardEpochId, DEFAULT_VOTER_WEIGHT);
  }

  registerRewardsForRewardEpoch(rewardEpochId: number, forceClosure = false) {
    this.logger.debug(`Registering rewards for reward epoch ${rewardEpochId}`);

    if (!this.rewardCalculator) {
      throw new Error("Reward calculator not initialized");
    }
    let rewardOffers = this.rewardEpochOffers.get(rewardEpochId);
    if (!rewardOffers) {
      if (forceClosure) {
        rewardOffers = [];
      } else {
        throw new Error(`Reward offers for reward epoch ${rewardEpochId} not found`);
      }
    }
    if (this.rewardEpochOffersClosed.get(rewardEpochId)) {
      throw new Error("Reward epoch is already closed");
    }
    this.rewardCalculator.setRewardOffers(rewardEpochId, rewardOffers);
    this.rewardEpochOffersClosed.set(rewardEpochId, true);
  }

  async processNewBlocks() {
    const currentBlockNumber = await this.provider.getBlockNumber();
    while (this.lastProcessedBlockNumber < currentBlockNumber) {
      try {
        const block = await this.provider.getBlock(this.lastProcessedBlockNumber + 1);
        this.indexer.processBlock(block);
        this.lastProcessedBlockNumber++;
      } catch (e) {
        this.logger.error(e);
        return;
      }
    }
  }

  async commit(epochId: number) {
    const epochData = this.priceEpochData.get(epochId);
    if (!epochData) {
      throw new Error("Epoch data not found");
    }
    const hash = hashForCommit(this.address, epochData.random!, epochData.merkleRoot!, epochData.pricesHex!);
    await this.provider.commit(hash);
  }

  async reveal(epochId: number) {
    const epochData = this.priceEpochData.get(epochId);
    if (!epochData) {
      throw new Error("Epoch data not found for epoch " + epochId);
    }
    await this.provider.revealBitvote(epochData);
  }

  async sign(epochId: number, skipCalculation = false) {
    if (!skipCalculation) {
      await this.calculateResults(epochId);
    }
    const result = this.priceEpochResults.get(epochId);
    if (!result) {
      throw new Error("Result not found");
    }

    const signature = await this.provider.signMessage(result.merkleRoot!);
    await this.provider.signResult(epochId, result.merkleRoot!, {
      v: signature.v,
      r: signature.r,
      s: signature.s,
    });
  }

  async calculateResults(priceEpochId: number) {
    const rewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);
    await this.refreshVoterToWeightMaps(rewardEpoch);

    const revealResult = this.calculateRevealers(priceEpochId)!;
    if (revealResult.revealed.length === 0) {
      this.logger.info("No reveals !!!!!!!!!");
      // TODO: check when this can happen
      return;
    }
    const results: MedianCalculationResult[] = this.calculateFeedMedians(priceEpochId, revealResult, rewardEpoch);

    this.rewardCalculator.calculateClaimsForPriceEpoch(priceEpochId, results);
    const rewards = this.rewardCalculator.getRewardMappingForPriceEpoch(priceEpochId);
    const rewardClaimHashes: string[] = [];
    for (const claimRewardList of rewards.values()) {
      for (const claim of claimRewardList) {
        claim.hash = hashClaimReward(claim, encodingUtils.abiForName("claimRewardBodyDefinition")!);
        rewardClaimHashes.push(claim.hash);
      }
    }

    const dataMerkleTree = new MerkleTree(rewardClaimHashes);
    const dataMerkleRoot = dataMerkleTree.root!;

    let priceMessage = "";
    let symbolMessage = "";
    results.map(data => {
      priceMessage += Web3.utils.padLeft(data.data.finalMedianPrice.toString(16), PRICE_BYTES * 2);
      symbolMessage += unprefixedSymbolBytes(data.feed);
    });

    const message = Web3.utils.padLeft(priceEpochId.toString(16), EPOCH_BYTES * 2) + priceMessage + symbolMessage;
    const priceMessageHash = Web3.utils.soliditySha3("0x" + message)!;
    const merkleRoot = sortedHashPair(priceMessageHash, dataMerkleRoot);

    // add merkle proofs to the claims for this FTSO client
    rewards.get(this.address)?.forEach(claim => {
      if (!claim.hash) {
        throw new Error("Assert: Claim hash must be calculated.");
      }
      const merkleProof = dataMerkleTree.getProof(claim.hash!);
      if (!merkleProof) {
        throw new Error("Assert: Merkle proof must be set.");
      }
      claim.merkleProof = merkleProof;
      // Adding the price message hash to the merkle proof, due to construction of the tree
      claim.merkleProof.push(priceMessageHash);
    });

    this.logger.debug(
      `Storing price epoch results for ${priceEpochId}: data mr ${dataMerkleRoot}, mr: ${merkleRoot}, reward proofs: ${JSON.stringify(
        rewards.get(this.address)!!
      )}`
    );

    this.priceEpochResults.set(priceEpochId, {
      priceEpochId: priceEpochId,
      medianData: results,
      priceMessage: "0x" + priceMessage,
      symbolMessage: "0x" + symbolMessage,
      fullPriceMessage: "0x" + message,
      fullMessage: dataMerkleRoot + message,
      dataMerkleRoot,
      dataMerkleProof: priceMessageHash,
      rewards,
      merkleRoot,
    } as EpochResult);
  }

  orderedPriceFeeds(priceEpochId: number): (IPriceFeed | undefined)[] {
    const rewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);
    return this.rewardCalculator
      .getFeedSequenceForRewardEpoch(rewardEpoch)
      .map(feed => this.priceFeeds.get(feedId(feed)));
  }

  preparePriceFeedsForPriceEpoch(priceEpochId: number) {
    const data = this.priceEpochData.get(priceEpochId) || { epochId: priceEpochId };
    this.priceEpochData.set(priceEpochId, data);
    data.merkleRoot = ZERO_BYTES32;
    data.prices = this.orderedPriceFeeds(priceEpochId).map(priceFeed =>
      priceFeed ? priceFeed.getPriceForEpoch(priceEpochId) : NON_EXISTENT_PRICE
    );
    data.pricesHex = packPrices(data.prices);
    data.random = Web3.utils.randomHex(32);
    data.bitVote = "0x00";
  }

  private async sendSignaturesForMyMerkleRoot(epochId: number) {
    const signaturesTmp = [...this.indexer.getSignatures(epochId)!.values()];
    const mySignatureHash = this.priceEpochResults.get(epochId)!.merkleRoot!;
    const signatures = signaturesTmp
      .filter(sig => sig.merkleRoot === mySignatureHash)
      .map(sig => {
        return {
          v: sig.v,
          r: sig.r,
          s: sig.s,
        } as BareSignature;
      });
    // TODO: Handle finalization failures more gracefully – it's expected that another provier may finalize before us.
    try {
      const id = Web3.utils.randomHex(8);
      this.logger.debug(`[${this.address.slice(0, 4)}] Trying to finalize ${id}`);
      const result = await this.provider.finalize(epochId, mySignatureHash, signatures);
      this.logger.debug(
        `[${this.address.slice(0, 4)}] Finalization succesfull ${id}: ${result}, epoch ${epochId}, sig count ${
          signatures.length
        }`
      );
    } catch (e) {
      this.logger.debug(`Error finalizing: ${e}`);
    }
  }

  async publishPrices(epochId: number, symbolIndices: number[]) {
    const result = this.priceEpochResults.get(epochId);
    if (!result) {
      throw new Error("Result not found");
    }
    return await this.provider.publishPrices(result, symbolIndices);
  }

  async claimReward(rewardEpochId: number) {
    const claimPriceEpochId = this.epochs.lastPriceEpochForRewardEpoch(rewardEpochId);
    const result = this.priceEpochResults.get(claimPriceEpochId)!;
    const rewardClaims = result.rewards.get(this.address) || [];
    const receipts = [];
    for (const rewardClaim of rewardClaims) {
      const receipt = await this.provider.claimReward(rewardClaim);
      receipts.push(receipt);
    }
    return receipts;
  }

  /**
   * Returns the list of claims for the given reward epoch and claimer.
   */
  claimsForClaimer(rewardEpochId: number, claimer: string): ClaimReward[] {
    const claimPriceEpochId = this.epochs.lastPriceEpochForRewardEpoch(rewardEpochId);
    const result = this.priceEpochResults.get(claimPriceEpochId)!;
    return result.rewards.get(claimer.toLowerCase()) || [];
  }

  /**
   * Returns the list of eligible voters with their weights for the given reward epoch.
   * It reads the data from the provider and caches it.
   */
  private async refreshVoterToWeightMaps(rewardEpoch: number): Promise<void> {
    let eligibleVoters = this.eligibleVotersForRewardEpoch.get(rewardEpoch);
    if (!this.eligibleVoterWeights.has(rewardEpoch)) {
      eligibleVoters = await this.provider.allVotersWithWeightsForRewardEpoch(rewardEpoch);
      this.eligibleVotersForRewardEpoch.set(rewardEpoch, eligibleVoters);
      const weightMap = new Map<string, BN>();
      this.eligibleVoterWeights.set(rewardEpoch, weightMap);
      let totalWeight = toBN(0);
      for (const voter of eligibleVoters) {
        weightMap.set(voter.voterAddress.toLowerCase(), voter.weight);
        totalWeight = totalWeight.add(voter.weight);
      }
      this.eligibleVoterTotalWeight.set(rewardEpoch, totalWeight);
    }
  }

  private calculateFeedMedians(
    priceEpochId: number,
    revealResult: RevealResult,
    rewardEpoch: number
  ): MedianCalculationResult[] {
    const orderedPriceFeeds = this.orderedPriceFeeds(priceEpochId);
    const numberOfFeeds = orderedPriceFeeds.length;

    const voters = revealResult.revealed;
    const weights = voters.map(voter => this.eligibleVoterWeights.get(rewardEpoch)!.get(voter.toLowerCase())!);

    const pricesForVoters = voters.map(voter => {
      const revealData = this.indexer.getReveals(priceEpochId)!.get(voter.toLowerCase())!;
      let feeds =
        revealData.prices
          .slice(2)
          .match(/(.{1,8})/g)
          ?.map(hex => parseInt(hex, 16)) || [];
      feeds = feeds.slice(0, numberOfFeeds);
      return padEndArray(feeds, numberOfFeeds, 0);
    });

    const results: MedianCalculationResult[] = [];
    for (let i = 0; i < numberOfFeeds; i++) {
      const prices = pricesForVoters.map(allPrices => toBN(allPrices[i]));
      const data = calculateMedian(voters, prices, weights);
      results.push({
        feed: {
          offerSymbol: orderedPriceFeeds[i]?.getFeedInfo().offerSymbol,
          quoteSymbol: orderedPriceFeeds[i]?.getFeedInfo().quoteSymbol,
        } as Feed,
        voters: voters,
        prices: prices.map(price => price.toNumber()),
        data: data,
        weights: weights,
      } as MedianCalculationResult);
    }
    return results;
  }

  /** Once sufficient voter weight in received signatures is observed, will call finalize. */
  private async onSignatureMaybeFinalize(signature: SignatureData) {
    this.logger.debug(`Got signature for epoch ${signature.epochId}`);

    const signatureByVoter = this.indexer.getSignatures(signature.epochId)!;
    const rewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(signature.epochId);
    const weightThreshold = await this.provider.thresholdForRewardEpoch(rewardEpoch);
    const voterWeights = this.eligibleVoterWeights.get(rewardEpoch)!;

    let totalWeight = toBN(0);
    for (const [voter, signature] of signatureByVoter) {
      const weight = voterWeights.get(voter)!;
      totalWeight = totalWeight.add(weight);
      if (totalWeight.gt(weightThreshold)) {
        this.logger.debug(
          `Weight threshold reached for ${
            signature.epochId
          }: ${totalWeight.toString()} >= ${weightThreshold.toString()}!, calling finalize with ${
            signatureByVoter.size
          } signatures`
        );

        this.indexer.off(Received.Signature, this.signatureListener);
        await this.sendSignaturesForMyMerkleRoot(signature.epochId);
        return;
      }
    }
  }

  private async onRewardOffers(priceEpoch: number, offers: RewardOffered[]) {
    const currentRewardEpochId = this.epochs.rewardEpochIdForPriceEpochId(priceEpoch);
    const nextRewardEpoch = currentRewardEpochId + 1;
    this.logger.debug(`Got reward offers for price epoch ${priceEpoch}, setting for ${nextRewardEpoch}`);
    if (offers && offers.length > 0) {
      if (this.rewardEpochOffersClosed.get(nextRewardEpoch)) {
        this.logger.error("Reward epoch is closed");
        return;
      }
    }
    const offersInEpoch = this.rewardEpochOffers.get(nextRewardEpoch) ?? [];
    this.rewardEpochOffers.set(nextRewardEpoch, offersInEpoch);
    for (const offer of offers) {
      offersInEpoch.push(offer);
    }
    this.logger.debug(`Set reward offers for reward epoch ${nextRewardEpoch}`);
  }

  // Encoding of signed result
  // [4 epochId][32-byte merkle root][4-byte price sequence]
  private calculateRevealers(priceEpochId: number): RevealResult {
    const rewardEpochId = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);
    const commits = this.indexer.getCommits(priceEpochId);
    const reveals = this.indexer.getReveals(priceEpochId);

    if (!commits || !reveals) {
      // TODO: check if this is correct
      throw new Error("Commits or reveals not found");
    }

    const eligibleCommitters = [...commits.keys()]
      .map(sender => sender.toLowerCase())
      .filter(voter => this.eligibleVoterWeights.get(rewardEpochId)?.has(voter.toLowerCase())!);
    const revealed = eligibleCommitters.filter(sender => {
      const revealData = reveals!.get(sender);
      if (!revealData) {
        return false;
      }
      const commitHash = this.indexer.getCommits(priceEpochId)?.get(sender);
      return commitHash === hashForCommit(sender, revealData.random, revealData.merkleRoot, revealData.prices);
    });
    const failedCommit = [...this.eligibleVoterWeights.get(rewardEpochId)?.keys()!].filter(
      voter => !revealed.includes(voter.toLowerCase())
    );
    const revealedSet = new Set<string>(revealed);
    const committedFailedReveal = eligibleCommitters.filter(voter => !revealedSet.has(voter.toLowerCase()));
    const revealedRandoms = revealed.map(voter => reveals!.get(voter.toLowerCase())!.random);
    return {
      revealed,
      failedCommit,
      committedFailedReveal,
      revealedRandoms,
    } as RevealResult;
  }
}
