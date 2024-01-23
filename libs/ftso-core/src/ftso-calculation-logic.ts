import { DataForCalculations } from "./DataManager";
import { RewardOffers } from "./events";
import { FeedValueEncoder, ValueWithDecimals } from "./utils/FeedValueEncoder";
import { MerkleTree } from "./utils/MerkleTree";
import { MerkleTreeStructs } from "./utils/MerkleTreeStructs";
import {
  Address,
  EpochResult,
  Feed,
  MedianCalculationResult,
  MedianCalculationSummary,
  RandomCalculationResult,
} from "./voting-types";

// Constants

const EPOCH_BYTES = 4;
const PRICE_BYTES = 4;
const RANDOM_QUALITY_BYTES = 4;

const MAX_2_256 = 2n ** 256n;
const NON_BENCHED_RANDOM_VOTERS_MIN_COUNT = 2;

// Type definitions

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
 * Data for single with reward information (for inflation or community reward).
 */
export interface FeedWithTypeAndValue extends Feed {
  flrValue: bigint;
  isInflation: boolean;
}

// Main logic

/**
 * The main entrypoint for calculating the results of a voting round.
 * @param data
 * @returns
 */
export async function calculateResults(data: DataForCalculations): Promise<EpochResult> {
  const results: MedianCalculationResult[] = await calculateFeedMedians(data);

  // TODO: implement randomOffenders!!!
  const random = await calculateRandom(data);

  return calculateEpochResult(data.votingRoundId, results, random);
}

/**
 * Builds a Merkle tree containing price epoch results.
 * The tree is built from the bulk price hash, individual price hashes and the hash of the combined random value.
 * The bulk price hash contains all prices and symbols, and is used for more efficiently retrieving prices for all feeds in the epoch.
 * @param votingRoundId
 * @param medianResults
 * @param epochRandom
 * @returns
 */
export function calculateEpochResult(
  votingRoundId: number,
  medianResults: MedianCalculationResult[],
  epochRandom: RandomCalculationResult
): EpochResult {
  const merkleTree = new MerkleTree([
    MerkleTreeStructs.hashRandomCalculationResult(epochRandom),
    ...medianResults.map(result => MerkleTreeStructs.hashMedianCalculationResult(result)),
  ]);

  const epochResult: EpochResult = {
    votingRoundId: votingRoundId,
    medianData: medianResults,
    randomData: epochRandom,
    merkleTree: merkleTree,
  };
  return epochResult;
}

export async function calculateFeedMedians(data: DataForCalculations): Promise<MedianCalculationResult[]> {
  // const voters = revealResult.revealers;
  const voters = data.orderedVotersSubmissionAddresses;
  const weights = voters.map(voter => data.voterMedianVotingWeights.get(voter.toLowerCase())!);

  // "mapping": feedIndex => array of submissions by voters (in signing policy order)
  const feedValues = new Map<number, ValueWithDecimals[]>();
  let totalVotingWeight = 0n;
  for (const voter of voters) {
    const revealData = data.validEligibleReveals.get(voter.toLowerCase());
    totalVotingWeight += data.voterMedianVotingWeights.get(voter.toLowerCase());
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
  return data.feedOrder.map((feed, feedIndex) =>
    calculateResultsForFeed(data.votingRoundId, voters, feedValues[feedIndex], weights, feed, totalVotingWeight)
  );
}

/**
 * Given a list of voters, prices and weights, it calculates the median and other statistics.
 * @param voters Array of voter addresses (unique identifiers)
 * @param feedValues Array of feed value votes as ValueWithDecimals[] for each voter
 * @param weights Array of weights for each voter in voters array
 * @param decimals Feed decimal values
 * @returns 
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
      participatingWeight: 0n,
    };
  }
  const voteData = repack(voters, feedValues, weights).filter(voteDataItem => !voteDataItem.feedValue.isEmpty);
  // Sort by price
  voteData.sort((a, b) => a.feedValue.value - b.feedValue.value);
  let totalWeight = 0n;
  voteData.forEach(vote => (totalWeight += vote.weight));
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
    participatingWeight: totalWeight,
  };
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
    random = random + BigInt(revealData.random);
    if (!data.benchingWindowRevealOffenders.has(voter)) {
      nonBencherCount++;
    }
  }
  random = random % MAX_2_256;

  return {
    // If random is zero, the random may still be good enough, since the real random we use in applications is
    // the Merkle root of all medians, which is with many prices hard to predict.
    votingRoundId: data.votingRoundId,
    random: random,
    isSecure: nonBenchedOffendersSize == 0 && nonBencherCount >= NON_BENCHED_RANDOM_VOTERS_MIN_COUNT,
  };
}

// Helpers

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

/**
 * Sort feeds in canonical order.
 * Inflation feeds are first, sorted by feed name.
 * Then non-inflation feeds are sorted by decreasing value and on same value by feed name.
 * @param feeds
 * @returns
 */
export function sortFeedWithValuesToCanonicalOrder(feeds: FeedWithTypeAndValue[]): FeedWithTypeAndValue[] {
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
      const feedName = inflationOffer.feedNames[i].toLowerCase();
      let feedValueType = feedValues.get(feedName);
      if (feedValueType === undefined) {
        feedValueType = {
          name: feedName,
          decimals: inflationOffer.decimals[i],
          isInflation: true,
          flrValue: 0n, // irrelevant for inflation offers
        };
        feedValues.set(feedValueType.name, feedValueType);
      }
    }
  }

  for (const communityOffer of rewardOffers.rewardOffers) {
    const feedName = communityOffer.feedName.toLowerCase();
    let feedValueType = feedValues.get(feedName); 
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

export function calculateResultsForFeed(
  votingRoundId: number,
  voters: string[],
  feedValues: ValueWithDecimals[],
  weights: bigint[],
  feed: Feed,
  totalVotingWeight: bigint
) {
  const medianSummary = calculateMedian(voters, feedValues, weights, feed.decimals);
  const result: MedianCalculationResult = {
    votingRoundId,
    feed: feed,
    voters: voters,
    feedValues: feedValues,
    data: medianSummary,
    weights: weights,
    totalVotingWeight,
  };
  return result;
}


