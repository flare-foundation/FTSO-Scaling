import BN from "bn.js";
import Web3 from "web3";

import { EpochSettings } from "./EpochSettings";
import { MerkleTree } from "./MerkleTree";
import { Penalty, RewardCalculator } from "./rewards/RewardCalculator";
import { calculateResultsForFeed } from "./median-calculation-utils";
import { IPriceFeed } from "./price-feeds/IPriceFeed";
import { IVotingProvider } from "./providers/IVotingProvider";
import {
  BareSignature,
  BlockData,
  RewardClaimWithProof,
  EpochData,
  EpochResult,
  FinalizeData,
  MedianCalculationResult,
  RevealResult,
  RewardOffered,
  SignatureData,
  VoterWithWeight,
  RewardClaim,
  Feed,
} from "./voting-interfaces";
import {
  ZERO_BYTES32,
  feedId,
  hashRewardClaim,
  hashForCommit,
  packPrices,
  sortedHashPair,
  toBN,
  unprefixedSymbolBytes,
  combineRandom,
} from "./voting-utils";
import { getLogger } from "./utils/logger";
import { BlockIndex, Received } from "./BlockIndex";
import { retry } from "./utils/retry";
import { sleepFor } from "./time-utils";
import { Bytes32 } from "./utils/sol-types";
import { asError, errorString } from "./utils/error";
import { BlockIndexer } from "./rewards/BlockIndexer";

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

  rewardCalculator!: RewardCalculator;
  lastProcessedBlockNumber: number = 0;
  epochs: EpochSettings;

  readonly index: BlockIndex;
  readonly priceEpochData = new Map<number, EpochData>();
  readonly priceEpochResults = new Map<number, EpochResult>();

  // reward epoch => voter => weight
  private eligibleVotersForRewardEpoch = new Map<number, VoterWithWeight[]>();
  eligibleVoterWeights = new Map<number, Map<string, BN>>();
  private eligibleVoterTotalWeight = new Map<number, BN>();

  readonly rewardEpochOffers = new Map<number, RewardOffered[]>();
  private readonly rewardEpochOffersClosed = new Map<number, boolean>();
  private readonly priceFeeds: Map<string, IPriceFeed> = new Map<string, IPriceFeed>();

  private readonly signatureListener = async (s: SignatureData) => this.checkSignaturesAndTryFinalize(s);

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
    this.index = new BlockIndexer(this.epochs, this.provider);
    this.index.on(Received.Offers, (pe: number, o: RewardOffered[]) => this.onRewardOffers(pe, o));

    this.lastProcessedBlockNumber = startBlockNumber - 1;
  }

  initializeRewardCalculator(initialRewardEpoch: number) {
    this.rewardCalculator = new RewardCalculator(this.epochs, initialRewardEpoch);
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

  /**
   * Processes new blocks by first asynchronously requesting blocks and then
   * sequentially processing them.
   */
  async processNewBlocks() {
    try {
      const currentBlockNumber = await this.provider.getBlockNumber();
      while (this.lastProcessedBlockNumber < currentBlockNumber) {
        const block = await retry(
          async () => {
            return await this.provider.getBlock(this.lastProcessedBlockNumber + 1);
          },
          3,
          2000
        );
        // this.logger.info(`Processing block ${block.number}`);
        await this.index.processBlock(block);
        this.lastProcessedBlockNumber++;
      }
    } catch (e: unknown) {
      this.logger.error(`Error processing new blocks: ${errorString(e)}`);
    }
  }

  async commit(priceEpochId: number) {
    const epochData = this.priceEpochData.get(priceEpochId);
    if (!epochData) {
      throw new Error("Epoch data not found");
    }
    const hash = hashForCommit(this.address, epochData.random.value, epochData.merkleRoot, epochData.pricesHex);
    await this.provider.commit(hash);
  }

  async reveal(priceEpochId: number) {
    const epochData = this.priceEpochData.get(priceEpochId);
    if (!epochData) {
      throw new Error("Epoch data not found for epoch " + priceEpochId);
    }
    await this.provider.revealBitvote(epochData);
  }

  async calculateResultsAndSign(priceEpochId: number, skipCalculation = false) {
    if (!skipCalculation) {
      await this.calculateResults(priceEpochId);
    }
    const result = this.priceEpochResults.get(priceEpochId);
    if (!result) {
      throw new Error("Result not found");
    }

    const signature = await this.provider.signMessage(result.merkleRoot!);
    await this.provider.signResult(priceEpochId, result.merkleRoot!, {
      v: signature.v,
      r: signature.r,
      s: signature.s,
    });
  }

  async calculateResults(priceEpochId: number) {
    const rewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);

    this.logger.info(
      `Reward epoch offer for ${priceEpochId} rewards: ${JSON.stringify(this.rewardEpochOffers.get(rewardEpoch))}`
    );

    await this.refreshVoterToWeightMaps(rewardEpoch);

    const revealResult = this.calculateRevealers(priceEpochId)!;
    if (revealResult.revealed.length === 0) {
      throw new Error(`No reveals for for price epoch: ${priceEpochId}.`);
    }

    const randomQuality = revealResult.committedFailedReveal.length;
    const combinedRandom = combineRandom(revealResult.revealedRandoms);

    const results: MedianCalculationResult[] = this.calculateFeedMedians(priceEpochId, revealResult, rewardEpoch);
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

    const [rewardMerkleRoot, priceEpochRewards] = await this.calculateRewards(
      priceEpochId,
      results,
      revealResult.committedFailedReveal
    );

    this.logger.info(`Reward merkle root for epoch ${priceEpochId}: ${rewardMerkleRoot}`);

    const priceEpochMerkleRoot = sortedHashPair(priceMessageHash, rewardMerkleRoot)!;

    const epochResult: EpochResult = {
      priceEpochId: priceEpochId,
      medianData: results,
      random: combinedRandom,
      randomQuality: randomQuality,
      priceMessage: "0x" + priceMessage,
      symbolMessage: "0x" + symbolMessage,
      randomMessage: "0x" + randomMessage,
      fullPriceMessage: "0x" + message,
      fullMessage: rewardMerkleRoot + message,
      rewardClaimMerkleRoot: rewardMerkleRoot,
      rewardClaimMerkleProof: priceMessageHash,
      rewardClaims: priceEpochRewards,
      merkleRoot: priceEpochMerkleRoot,
    };
    this.priceEpochResults.set(priceEpochId, epochResult);
  }

  private async calculateRewards(
    priceEpochId: number,
    results: MedianCalculationResult[],
    committedFailedReveal: string[]
  ): Promise<[string, RewardClaim[]]> {
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

    const voterWeights = this.eligibleVoterWeights.get(this.epochs.rewardEpochIdForPriceEpochId(priceEpochId))!;

    this.rewardCalculator.calculateClaimsForPriceEpoch(
      priceEpochId,
      finalizationData?.[0].from,
      rewardedSigners,
      results,
      committedFailedReveal,
      voterWeights
    );

    const rewardClaims = this.rewardCalculator
      .getRewardClaimsForPriceEpoch(priceEpochId)
      .filter(claim => !(claim instanceof Penalty));
    this.logger.info(`Calculated ${rewardClaims.length} reward claims for price epoch ${priceEpochId}.`);
    const rewardClaimHashes: string[] = rewardClaims.map(claim => hashRewardClaim(claim));
    const rewardMerkleTree = new MerkleTree(rewardClaimHashes);
    const rewardMerkleRoot = rewardMerkleTree.root!;
    return [rewardMerkleRoot, rewardClaims];
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

    const epochSignatures = this.index.getSignatures(priceEpochId - 1);
    for (const [signature, signatureTime] of epochSignatures.values()) {
      if (signatureTime > finalizationTime) continue; // Only reward signatures with block timestamp no greater than that of finalization
      const signer = await this.provider.recoverSigner(data.merkleRoot, signature);
      // We check if the signer is registered for the _current_ reard epoch, the signature reward epoch might be one earlier.
      const signerWeight = this.eligibleVoterWeights
        .get(this.epochs.rewardEpochIdForPriceEpochId(priceEpochId))!
        .get(signer);
      if (signerWeight && signerWeight.gt(toBN(0))) {
        rewardedSigners.add(signer);
      }
    }
    return Array.from(rewardedSigners);
  }

  orderedPriceFeeds(priceEpochId: number): (IPriceFeed | undefined)[] {
    const rewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);
    return this.rewardCalculator
      .getFeedSequenceForRewardEpoch(rewardEpoch)
      .map(feed => this.priceFeeds.get(feedId(feed)));
  }

  orderedPriceFeedIds(priceEpochId: number): Feed[] {
    const rewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);
    return this.rewardCalculator.getFeedSequenceForRewardEpoch(rewardEpoch);
    // .map(feed => feed.feedId);
  }

  preparePriceFeedsForPriceEpoch(priceEpochId: number) {
    if (this.priceEpochData.has(priceEpochId)) {
      throw new Error(`Data for price epoch ${priceEpochId} already exists`);
    }
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
    this.priceEpochData.set(priceEpochId, data);
  }

  private async tryFinalizeEpoch(priceEpochId: number, merkleRoot: string, signatures: SignatureData[]) {
    try {
      this.logger.info(`Submitting finalization transaction for epoch ${priceEpochId}.`);
      await this.provider.finalize(priceEpochId, merkleRoot, signatures);
      this.logger.info(`Successfully submitted finalization transaction for epoch ${priceEpochId}.`);
    } catch (e) {
      this.logger.info(`Failed to submit finalization transaction: ${errorString(e)}`);
    }
  }

  async publishPrices(peiceEpochId: number, symbolIndices: number[]) {
    const result = this.priceEpochResults.get(peiceEpochId);
    if (!result) {
      throw new Error("Result not found");
    }
    return await this.provider.publishPrices(result, symbolIndices);
  }

  async claimRewards(rewardEpochId: number) {
    const rewardClaims = this.generateClaimsWithProofForClaimer(rewardEpochId, this.address);
    return await this.provider.claimRewards(rewardClaims, this.address);
  }

  generateClaimsWithProofForClaimer(rewardEpochId: number, claimer: string): RewardClaimWithProof[] {
    const claimPriceEpochId = this.epochs.lastPriceEpochForRewardEpoch(rewardEpochId);
    const result = this.priceEpochResults.get(claimPriceEpochId)!;

    const allClaims = result.rewardClaims;
    return this.generateProofsForClaims(allClaims, result.merkleRoot, claimer);
  }

  generateProofsForClaims(allClaims: readonly RewardClaim[], mroot: string, claimer: string) {
    const allHashes = allClaims.map(claim => hashRewardClaim(claim));
    const merkleTree = new MerkleTree(allHashes);
    if (merkleTree.root !== mroot) {
      throw new Error("Invalid Merkle root for reward claims");
    }

    const claimsWithProof: RewardClaimWithProof[] = [];
    for (let i = 0; i < allClaims.length; i++) {
      const claim = allClaims[i];
      if (claim.beneficiary.toLowerCase() === claimer.toLowerCase()) {
        claimsWithProof.push({
          merkleProof: getProof(i),
          body: claim,
        });
      }
    }

    this.logger.info(
      `Generating claims for ${claimer}, mroot ${merkleTree.root}, generated ${claimsWithProof.length} claims.`
    );

    return claimsWithProof;

    function getProof(i: number) {
      const proof = merkleTree.getProof(allHashes[i]);
      if (!proof) throw new Error(`No Merkle proof exists for claim hash ${allHashes[i]}`);
      // proof.push(mroot);
      return proof;
    }
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
    const orderedPriceFeeds = this.orderedPriceFeedIds(priceEpochId);
    const numberOfFeeds = orderedPriceFeeds.length;
    const voters = revealResult.revealed;
    const weights = voters.map(voter => this.eligibleVoterWeights.get(rewardEpoch)!.get(voter.toLowerCase())!);

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

  async tryFinalizeOnceSignaturesReceived(priceEpochId: number) {
    this.index.on(Received.Signature, this.signatureListener); // Will atempt to finalize once enough signatures are received.
    await this.processNewBlocks();
    this.logger.info(`Waiting for finalization of epoch ${priceEpochId}`);
    await this.awaitFinalization(priceEpochId);
    this.index.off(Received.Signature, this.signatureListener);
  }

  async awaitFinalization(priceEpochId: number) {
    while (!this.index.getFinalize(priceEpochId)) {
      this.logger.info(`Epoch ${priceEpochId} not finalized, keep processing new blocks`);
      await sleepFor(BLOCK_PROCESSING_INTERVAL_MS);
      await this.processNewBlocks();
    }
    this.logger.info(`Epoch ${priceEpochId} finalized, continue.`);
  }

  /**
   * Once sufficient voter weight in received signatures is observed, will call finalize.
   * @returns true if enough signatures were found and finalization was attempted.
   */
  private async checkSignaturesAndTryFinalize(signatureData: SignatureData): Promise<boolean> {
    const priceEpochId = signatureData.epochId;
    if (priceEpochId! in this.priceEpochResults) {
      throw Error(`Invalid state: trying to finalize ${priceEpochId}, but results not yet computed.`);
    }

    const priceEpochMerkleRoot = this.priceEpochResults.get(priceEpochId)!.merkleRoot!;
    const signatureBySender = this.index.getSignatures(priceEpochId)!;
    const rewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);
    const weightThreshold = await this.provider.thresholdForRewardEpoch(rewardEpoch);
    const voterWeights = this.eligibleVoterWeights.get(rewardEpoch)!;
    let totalWeight = toBN(0);

    const validSignatures = new Map<string, SignatureData>();
    for (const [signature, _time] of signatureBySender.values()) {
      if (signature.merkleRoot !== priceEpochMerkleRoot) continue;
      const signer = await this.provider.recoverSigner(priceEpochMerkleRoot, signature);
      // Deduplicate signers, since the same signature can in theory be published multiple times by different accounts.
      if (validSignatures.has(signer)) continue;

      const weight = voterWeights.get(signer) ?? toBN(0);
      // Weight == 0 could mean that the signer is not registered for this reward epoch OR that the signature is invalid.
      // We skip the signature in both cases.
      if (weight.gt(toBN(0))) {
        validSignatures.set(signer, signature);
        totalWeight = totalWeight.add(weight);

        if (totalWeight.gt(weightThreshold)) {
          this.logger.debug(
            `Weight threshold reached for ${priceEpochId}: ${totalWeight.toString()} >= ${weightThreshold.toString()}, calling finalize with ${
              validSignatures.size
            } signatures`
          );

          this.index.off(Received.Signature, this.signatureListener);
          await this.tryFinalizeEpoch(priceEpochId, priceEpochMerkleRoot, [...validSignatures.values()]);
          return true;
        }
      }
    }
    return false;
  }

  async onRewardOffers(priceEpoch: number, offers: RewardOffered[]) {
    const currentRewardEpochId = this.epochs.rewardEpochIdForPriceEpochId(priceEpoch);
    const nextRewardEpoch = currentRewardEpochId + 1;
    this.logger.info(`Got reward offers for price epoch ${priceEpoch}, setting for ${nextRewardEpoch}`);
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
    this.logger.info(`Set reward offers for reward epoch ${nextRewardEpoch}`);
  }

  // Encoding of signed result
  // [4 epochId][32-byte merkle root][4-byte price sequence]
  private calculateRevealers(priceEpochId: number): RevealResult {
    const rewardEpochId = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);
    const commits = this.index.getCommits(priceEpochId);
    const reveals = this.index.getReveals(priceEpochId);

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
      const commitHash = this.index.getCommits(priceEpochId)?.get(sender);
      return commitHash === hashForCommit(sender, revealData.random, revealData.merkleRoot, revealData.prices);
    });
    const failedCommit = [...this.eligibleVoterWeights.get(rewardEpochId)?.keys()!].filter(
      voter => !revealed.includes(voter.toLowerCase())
    );
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
