import Web3 from "web3";
import { DataForCalculations } from "./DataManager";
import { RewardOffers } from "./events";
import { FeedValueEncoder, ValueWithDecimals } from "./utils/FeedEncoder";
import { MerkleTree } from "./utils/MerkleTree";
import { Bytes32 } from "./utils/sol-types";
import { hashBytes } from "./utils/voting-utils";
import { Address, EpochResult, Feed, MedianCalculationResult, MedianCalculationSummary, RandomCalculationResult } from "./voting-types";
const EPOCH_BYTES = 4;
const PRICE_BYTES = 4;
const RANDOM_QUALITY_BYTES = 4;

const RANDOM_MAX_VAL = 2n ** 256n - 1n;
const NON_BENCHED_RANDOM_VOTERS_MIN_COUNT = 2;

/**
 * Data for a single vote.
 */
interface VoteData {
  voter: string;
  feedValue: ValueWithDecimals;
  weight: bigint;
  initialIndex: number;
}

/**
 * Repacks voters, prices and weights into a single array of VoteData.
 * All arrays must have the same length.
 */
function repack(voters: string[], feedValues: ValueWithDecimals[], weights: bigint[]): VoteData[] {
  const result: VoteData[] = [];
  if (voters.length !== feedValues.length || voters.length !== weights.length) {
    throw new Error("voters, prices and weights must have the same length");
  }
  for (let i = 0; i < voters.length; i++) {
    result.push({
      voter: voters[i],
      feedValue: feedValues[i],
      weight: weights[i],
      initialIndex: i,
    });
  }
  return result;
}

// TODO: must calculate random number as well using revealWithholders
export async function calculateResults(data: DataForCalculations): Promise<EpochResult> {
  const results: MedianCalculationResult[] = await calculateFeedMedians(data);

  // TODO: implement randomOffenders!!!
  const random = await calculateRandom(data);

  return calculateEpochResult(results, random, data.votingRoundId);
}

/**
 * A random is considered safe if
 * - all of the current round reveal offenders are already benched
 * - the number of non-benched offenders that successfully revealed is at least 2
 * @param data
 * @returns
 */
async function calculateRandom(data: DataForCalculations): Promise<RandomCalculationResult> {
  const nonBenchedOffendersSize = [...data.revealOffenders].filter(
    voter => !data.benchingWindowRevealOffenders.has(voter.toLowerCase())
  ).length;
  let random = 0n;
  
  let nonBencherCount = 0;
  for (const [voter, revealData] of data.validEligibleReveals) {
    random = random + BigInt(revealData.random) % RANDOM_MAX_VAL;
    if(!data.benchingWindowRevealOffenders.has(voter)) {
      nonBencherCount++;
    }
  }

  return {
    // If random is zero, the random may still be good enough, since the real random we use in applications is 
    // the Merkle root of all medians, which is with many prices hard to predict.
    random: random,
    isSafe: (nonBenchedOffendersSize == 0 && nonBencherCount >= NON_BENCHED_RANDOM_VOTERS_MIN_COUNT),
  };
}

interface FeedWithTypeAndValue extends Feed {
  flrValue: bigint;
  isInflation: boolean;
}

/**
 * Sort feeds in canonical order.
 * Inflation feeds are first, sorted by feed name.
 * Then non-inflation feeds are sorted by decreasing value and on same value by feed name.
 * @param feeds
 * @returns
 */
function sortFeedWithValuesToCanonicalOrder(feeds: FeedWithTypeAndValue[]): FeedWithTypeAndValue[] {
  feeds.sort((a, b) => {
    if (a.isInflation && !b.isInflation) {
      return -1;
    }
    if (!a.isInflation && b.isInflation) {
      return 1;
    }
    if (a.isInflation && b.isInflation) {
      if (a.name < b.name) {
        return -1;
      }
      if (a.name > b.name) {
        return 1;
      }
      return 0; // should not happen
    }
    // None is from inflation.
    // Sort decreasing by value and on same value increasing by feedName

    if (a.flrValue > b.flrValue) {
      return -1;
    }
    if (a.flrValue < b.flrValue) {
      return 1;
    }
    // values are same, sort lexicographically
    if (a.name < b.name) {
      return -1;
    }
    if (a.name > b.name) {
      return 1;
    }
    return 0; // Should not happen, Offers for same feed should be merged
  });
  return feeds;
}

/**
 * Calculates a deterministic sequence of feeds based on the provided offers for a reward epoch.
 * The sequence is sorted by the value of the feed in the reward epoch in decreasing order.
 * In case of equal values the feedId is used to sort in increasing order.
 * The sequence defines positions of the feeds in the price vectors for the reward epoch.
 * @param rewardOffers
 * @returns
 */
export function rewardEpochFeedSequence(rewardOffers: RewardOffers): Feed[] {
  const feedValues = new Map<string, FeedWithTypeAndValue>();

  for (const inflationOffer of rewardOffers.inflationOffers) {
    for (let i = 0; i < inflationOffer.feedNames.length; i++) {
      let feedValueType = feedValues.get(inflationOffer.feedNames[i]);
      if (feedValueType === undefined) {
        feedValueType = {
          name: inflationOffer.feedNames[i],
          decimals: inflationOffer.decimals[i],
          isInflation: true,
          flrValue: 0n, // irrelevant for inflation offers
        };
        feedValues.set(feedValueType.name, feedValueType);
      }
    }
  }

  for (const communityOffer of rewardOffers.rewardOffers) {
    let feedValueType = feedValues.get(communityOffer.feedName);
    if (feedValueType === undefined) {
      feedValueType = {
        name: communityOffer.feedName.toLowerCase(), // hex values
        decimals: communityOffer.decimals,
        isInflation: false,
        flrValue: 0n,
      };
      feedValues.set(feedValueType.name, feedValueType);
    }
    feedValueType.flrValue += feedValueType.flrValue + communityOffer.amount;
  }

  const feedSequence = sortFeedWithValuesToCanonicalOrder(Array.from(feedValues.values()));

  return feedSequence.map(feedValueType => {
    return {
      name: feedValueType.name,
      decimals: feedValueType.decimals,
    };
  });
}

/**
 * Builds a Merkle tree containing price epoch results.
 * The tree is built from the bulk price hash, individual price hashes and the hash of the combined random value.
 * The bulk price hash contains all prices and symbols, and is used for more efficiently retrieving prices for all feeds in the epoch.
 */
export function calculateEpochResult(
  medianResults: MedianCalculationResult[],
  epochRandom: RandomCalculationResult,
  priceEpochId: number
): EpochResult {
  const encodedPriceEpochId = Web3.utils.padLeft(priceEpochId.toString(16), EPOCH_BYTES * 2);
  const encodedIndividualPrices: string[] = [];

  let encodedBulkPrices = "";
  let encodedBulkSymbols = "";
  medianResults.forEach(data => {
    const encodedPrice = Web3.utils.padLeft(data.data.finalMedianPrice.toString(16), PRICE_BYTES * 2);
    encodedBulkPrices += encodedPrice;
    encodedBulkSymbols += data.feed.name;
    // TODO: this needs to be fixed to use correct Merkle leaf encoding
    encodedIndividualPrices.push("0x" + encodedPriceEpochId + data.feed.name.slice(2) + encodedPrice);
  });

  const encodedBulkPricesWithSymbols = "0x" + encodedPriceEpochId + encodedBulkPrices + encodedBulkSymbols;
  const bulkHash = hashBytes(encodedBulkPricesWithSymbols);
  const individualPriceHashes = encodedIndividualPrices.map(tuple => hashBytes(tuple));

  const encodedRandom =
    "0x" +
    encodedPriceEpochId +
    Web3.utils.padLeft(epochRandom.isSafe ? "01" : "00", RANDOM_QUALITY_BYTES * 2) +
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

export async function calculateFeedMedians(data: DataForCalculations): Promise<MedianCalculationResult[]> {
  // const voters = revealResult.revealers;
  const voters = data.orderedVotersSubmissionAddresses;
  const weights = voters.map(voter => data.voterMedianVotingWeights.get(voter.toLowerCase())!);

  // "mapping": feedIndex => array of submissions by voters (in signing policy order)
  const feedValues = new Map<number, ValueWithDecimals[]>();
  for (const voter of voters) {
    const revealData = data.validEligibleReveals.get(voter.toLowerCase());
    let encodedVoterValues: ValueWithDecimals[] = [];
    if (revealData) {
      encodedVoterValues = FeedValueEncoder.decode(revealData.encodedValues, data.feedOrder);
    } else {
      encodedVoterValues = FeedValueEncoder.emptyFeeds(data.feedOrder);
    }
    // The length of encodedVoterValues always matches the number of feeds
    for (const [feedIndex, feedValue] of encodedVoterValues.entries()) {
      const array = feedValues.get(feedIndex) || [];
      array.push(feedValue);
      feedValues.set(feedIndex, array);
    }
  }
  // trigger calculations for all feed
  return data.feedOrder.map((feed, feedIndex) => calculateResultsForFeed(voters, feedValues[feedIndex], weights, feed));
}

export function calculateResultsForFeed(
  voters: string[],
  feedValues: ValueWithDecimals[],
  weights: bigint[],
  feed: Feed
) {
  const medianSummary = calculateMedian(voters, feedValues, weights, feed.decimals);
  const result: MedianCalculationResult = {
    feed: feed,
    voters: voters,
    feedValues: feedValues,
    data: medianSummary,
    weights: weights,
  };
  return result;
}

/**
 * Given a list of voters, prices and weights, it calculates the median and other statistics.
 */
export function calculateMedian(
  voters: Address[],
  feedValues: ValueWithDecimals[],
  weights: bigint[],
  decimals: number
): MedianCalculationSummary {
  if (voters.length !== feedValues.length || voters.length !== weights.length) {
    throw new Error("voters, prices and weights must have the same length");
  }
  if (voters.length === 0) {
    return {
      finalMedianPrice: FeedValueEncoder.emptyFeed(decimals),
      quartile1Price: FeedValueEncoder.emptyFeed(decimals),
      quartile3Price: FeedValueEncoder.emptyFeed(decimals),
    };
  }
  const voteData = repack(voters, feedValues, weights).filter(voteDataItem => !voteDataItem.feedValue.isEmpty);
  // Sort by price
  voteData.sort((a, b) => a.feedValue.value - b.feedValue.value);
  let totalWeight = 0n;
  weights.forEach(w => (totalWeight += w));
  const medianWeight = totalWeight / 2n + (totalWeight % 2n);
  let currentWeightSum = 0n;

  let medianPrice: number | undefined;
  const quartileWeight = totalWeight / 4n;
  let quartile1Price: number | undefined;
  let quartile3Price: number | undefined;

  for (let index = 0; index < voteData.length; index++) {
    const vote = voteData[index];
    currentWeightSum += vote.weight;
    if (quartile1Price === undefined && currentWeightSum > quartileWeight) {
      // calculation of border price for 1st quartile
      quartile1Price = vote.feedValue.value;
    }
    if (medianPrice === undefined && currentWeightSum >= medianWeight) {
      if (currentWeightSum === medianWeight && totalWeight % 2n === 0n) {
        const next = voteData[index + 1];
        // average of two middle prices in even case
        medianPrice = Math.floor((vote.feedValue.value + next.feedValue.value) / 2);
      } else {
        medianPrice = vote.feedValue.value;
      }
    }
    if (medianPrice !== undefined && quartile1Price !== undefined) {
      break;
    }
  }
  currentWeightSum = 0n;
  // calculation of border price for 3rd quartile
  for (let index = voteData.length - 1; index >= 0; index--) {
    const vote = voteData[index];
    currentWeightSum += vote.weight;
    if (currentWeightSum > quartileWeight) {
      quartile3Price = vote.feedValue.value;
      break;
    }
  }

  return {
    finalMedianPrice: FeedValueEncoder.feedForValue(medianPrice, decimals),
    quartile1Price: FeedValueEncoder.feedForValue(quartile1Price, decimals),
    quartile3Price: FeedValueEncoder.feedForValue(quartile3Price, decimals),
  };
}
