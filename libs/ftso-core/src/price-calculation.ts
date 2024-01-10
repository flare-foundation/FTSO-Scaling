import BN from "bn.js";
import {
  Address,
  EpochResult,
  Feed,
  MedianCalculationResult,
  MedianCalculationSummary,
  RevealResult,
  RewardOffered,
} from "./voting-types";
import {
  combineRandom,
  feedId,
  hashBytes,
  hashForCommit,
  parsePrices,
  toBN,
  unprefixedSymbolBytes,
} from "./utils/voting-utils";
import Web3 from "web3";
import { MerkleTree } from "./utils/MerkleTree";
import { Bytes32 } from "./utils/sol-types";
import _ from "lodash";
import { RevealData } from "./voting-types";
const EPOCH_BYTES = 4;
const PRICE_BYTES = 4;
const RANDOM_QUALITY_BYTES = 4;

/**
 * Data for a single vote.
 */
interface VoteData {
  voter: string;
  price: BN;
  weight: BN;
  initialIndex: number;
}

/**
 * Repacks voters, prices and weights into a single array of VoteData.
 * All arrays must have the same length.
 */
function repack(voters: string[], prices: BN[], weights: BN[]): VoteData[] {
  const result: VoteData[] = [];
  if (voters.length !== prices.length || voters.length !== weights.length) {
    throw new Error("voters, prices and weights must have the same length");
  }
  for (let i = 0; i < voters.length; i++) {
    result.push({
      voter: voters[i],
      price: prices[i],
      weight: weights[i],
      initialIndex: i,
    });
  }
  return result;
}
// TODO: Move away from BN
export async function calculateResults(
  priceEpochId: number,
  commits: Map<string, string>,
  reveals: Map<string, RevealData>,
  rewardOffers: RewardOffered[],
  voterWeights: Map<Address, BN>
): Promise<EpochResult> {
  console.log("Calculating results with commits: ", [...commits.keys()], "reveals", [...reveals.keys()]);
  const revealResult = await calculateRevealers(commits, reveals, voterWeights)!;
  if (revealResult.revealers.length === 0) {
    throw new Error(`No reveals for price epoch: ${priceEpochId}.`);
  }

  const results: MedianCalculationResult[] = await calculateFeedMedians(revealResult, voterWeights, rewardOffers);

  const random: [Bytes32, number] = [
    combineRandom(revealResult.revealedRandoms),
    revealResult.committedFailedReveal.length,
  ];
  return calculateEpochResult(results, random, priceEpochId);
}

export async function calculateRevealers(
  commits: Map<string, string>,
  reveals: Map<string, RevealData>,
  voterWeights: Map<Address, BN>
): Promise<RevealResult> {
  const committers = [...commits.keys()];
  const eligibleCommitters = committers
    .map(sender => sender.toLowerCase())
    .filter(voter => voterWeights.has(voter.toLowerCase())!);

  const failedCommit = _.difference(eligibleCommitters, committers);
  if (failedCommit.length > 0) {
    console.log(`Not seen commits from ${failedCommit.length} voters: ${failedCommit}`);
  }

  const [revealed, committedFailedReveal] = _.partition(eligibleCommitters, committer => {
    const revealData = reveals.get(committer);
    if (!revealData) {
      return false;
    }
    const commitHash = commits.get(committer);
    return commitHash === hashForCommit(committer, revealData.random, revealData.encodedPrices);
  });

  if (committedFailedReveal.length > 0) {
    console.log(`Not seen reveals from ${committedFailedReveal.length} voters: ${committedFailedReveal}`);
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

/**
 * Calculates a deterministic sequence of feeds based on the provided offers for a reward epoch.
 * The sequence is sorted by the value of the feed in the reward epoch in decreasing order.
 * In case of equal values the feedId is used to sort in increasing order.
 * The sequence defines positions of the feeds in the price vectors for the reward epoch.
 */
export function rewardEpochFeedSequence(rewardOffers: RewardOffered[]): Feed[] {
  const feedValues = new Map<string, FeedValue>();
  for (const offer of rewardOffers) {
    let feedValue = feedValues.get(feedId(offer));
    if (feedValue === undefined) {
      feedValue = {
        feedId: feedId(offer),
        offerSymbol: offer.offerSymbol,
        quoteSymbol: offer.quoteSymbol,
        flrValue: toBN(0),
      };
      feedValues.set(feedValue.feedId, feedValue);
    }
    feedValue.flrValue = feedValue.flrValue.add(offer.flrValue);
  }

  const feedSequence = Array.from(feedValues.values());
  feedSequence.sort((a: FeedValue, b: FeedValue) => {
    // sort decreasing by value and on same value increasing by feedId
    if (a.flrValue.lt(b.flrValue)) {
      return 1;
    } else if (a.flrValue.gt(b.flrValue)) {
      return -1;
    }
    if (feedId(a) < feedId(b)) {
      return -1;
    } else if (feedId(a) > feedId(b)) {
      return 1;
    }
    return 0;
  });
  return feedSequence;

  interface FeedValue extends Feed {
    feedId: string;
    flrValue: BN;
  }
}

/**
 * Builds a Merkle tree containing price epoch results.
 * The tree is built from the bulk price hash, individual price hashes and the hash of the combined random value.
 * The bulk price hash contains all prices and symbols, and is used for more efficiently retrieving prices for all feeds in the epoch.
 */
export function calculateEpochResult(
  medianResults: MedianCalculationResult[],
  epochRandom: [Bytes32, number],
  priceEpochId: number
): EpochResult {
  const encodedPriceEpochId = Web3.utils.padLeft(priceEpochId.toString(16), EPOCH_BYTES * 2);
  const encodedIndividualPrices: string[] = [];

  let encodedBulkPrices = "";
  let encodedBulkSymbols = "";
  medianResults.forEach(data => {
    const encodedPrice = Web3.utils.padLeft(data.data.finalMedianPrice.toString(16), PRICE_BYTES * 2);
    const encodedSymbol = unprefixedSymbolBytes(data.feed);
    encodedBulkPrices += encodedPrice;
    encodedBulkSymbols += encodedSymbol;
    encodedIndividualPrices.push("0x" + encodedPriceEpochId + encodedSymbol + encodedPrice);
  });

  const encodedBulkPricesWithSymbols = "0x" + encodedPriceEpochId + encodedBulkPrices + encodedBulkSymbols;
  const bulkHash = hashBytes(encodedBulkPricesWithSymbols);
  const individualPriceHashes = encodedIndividualPrices.map(tuple => hashBytes(tuple));

  const [random, quality] = epochRandom;
  const encodedRandom =
    "0x" +
    encodedPriceEpochId +
    Web3.utils.padLeft(quality.toString(16), RANDOM_QUALITY_BYTES * 2) +
    random.value.slice(2);
  const randomHash = hashBytes(encodedRandom);

  const merkleTree = new MerkleTree([bulkHash, ...individualPriceHashes, randomHash]);
  const bulkProof: Bytes32[] = merkleTree.getProof(bulkHash)!.map(p => Bytes32.fromHexString(p));

  const epochResult: EpochResult = {
    priceEpochId: priceEpochId,
    medianData: medianResults,
    random: random,
    randomQuality: quality,
    encodedBulkPrices: "0x" + encodedBulkPrices,
    encodedBulkSymbols: "0x" + encodedBulkSymbols,
    randomMessage: encodedRandom,
    encodedBulkPricesWithSymbols: encodedBulkPricesWithSymbols,
    bulkPriceProof: bulkProof,
    merkleRoot: Bytes32.fromHexString(merkleTree.root!),
  };
  return epochResult;
}

export async function calculateFeedMedians(
  revealResult: RevealResult,
  voterWeights: Map<Address, BN>,
  rewardOffers: RewardOffered[]
): Promise<MedianCalculationResult[]> {
  const orderedPriceFeeds: Feed[] = rewardEpochFeedSequence(rewardOffers);
  const numberOfFeeds = orderedPriceFeeds.length;
  const voters = revealResult.revealers;
  const weights = voters.map(voter => voterWeights.get(voter.toLowerCase())!);

  const feedPrices: BN[][] = orderedPriceFeeds.map(() => new Array<BN>());
  voters.forEach(voter => {
    const revealData = revealResult.reveals.get(voter.toLowerCase())!;
    const voterPrices = parsePrices(revealData.encodedPrices, numberOfFeeds);
    voterPrices.forEach((price, i) => feedPrices[i].push(price));
  });

  return orderedPriceFeeds.map((feed, i) => calculateResultsForFeed(voters, feedPrices[i], weights, feed));
}

export function calculateResultsForFeed(voters: string[], prices: BN[], weights: BN[], feed: Feed) {
  const medianSummary = calculateMedian(voters, prices, weights);
  const result: MedianCalculationResult = {
    feed: feed,
    voters: voters,
    prices: prices.map(price => price.toNumber()),
    data: medianSummary,
    weights: weights,
  };
  return result;
}

/**
 * Given a list of voters, prices and weights, it calculates the median and other statistics.
 */
export function calculateMedian(voters: Address[], prices: BN[], weights: BN[]): MedianCalculationSummary {
  const voteData = repack(voters, prices, weights);
  // Sort by price
  voteData.sort((a, b) => {
    if (a.price.lt(b.price)) {
      return -1;
    } else if (a.price.gt(b.price)) {
      return 1;
    }
    return 0;
  });
  let totalWeight = toBN(0);
  weights.forEach(w => (totalWeight = totalWeight.add(w)));
  const medianWeight = totalWeight.div(toBN(2)).add(totalWeight.mod(toBN(2)));
  let currentWeightSum = toBN(0);

  let medianPrice: BN | undefined;
  const quartileWeight = totalWeight.div(toBN(4));
  let quartile1Price: BN | undefined;
  let quartile3Price: BN | undefined;

  for (let index = 0; index < voteData.length; index++) {
    const vote = voteData[index];
    currentWeightSum = currentWeightSum.add(vote.weight);
    if (quartile1Price === undefined && currentWeightSum.gt(quartileWeight)) {
      // calculation of border price for 1st quartile
      quartile1Price = vote.price;
    }
    if (medianPrice === undefined && currentWeightSum.gte(medianWeight)) {
      if (currentWeightSum.eq(medianWeight) && totalWeight.isEven()) {
        const next = voteData[index + 1];
        // average of two middle prices in even case
        medianPrice = vote.price.add(next.price).div(toBN(2));
      } else {
        medianPrice = vote.price;
      }
    }
    if (medianPrice !== undefined && quartile1Price !== undefined) {
      break;
    }
  }
  currentWeightSum = toBN(0);
  // calculation of border price for 3rd quartile
  for (let index = voteData.length - 1; index >= 0; index--) {
    const vote = voteData[index];
    currentWeightSum = currentWeightSum.add(vote.weight);
    if (currentWeightSum.gt(quartileWeight)) {
      quartile3Price = vote.price;
      break;
    }
  }

  return {
    finalMedianPrice: medianPrice!.toNumber(),
    quartile1Price: quartile1Price!.toNumber(),
    quartile3Price: quartile3Price!.toNumber(),
  };
}
