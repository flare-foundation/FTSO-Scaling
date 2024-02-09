import { DataForCalculations } from "../data-calculation-interfaces";
import { FeedValueEncoder, ValueWithDecimals } from "../utils/FeedValueEncoder";
import { Address, Feed, MedianCalculationResult, MedianCalculationSummary } from "../voting-types";

/**
 * Data for a single vote.
 */
export interface VoteData {
  voter: string;
  feedValue: ValueWithDecimals;
  weight: bigint;
  initialIndex: number;
}

/**
 * Given a DataForCalculations object, it calculates the median calculation results for all feeds.
 */
export function calculateMedianResults(data: DataForCalculations): MedianCalculationResult[] {
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
    calculateResultForFeed(data.votingRoundId, voters, feedValues.get(feedIndex), weights, feed, totalVotingWeight)
  );
}

/**
 * Calculates median results for a specific feed.
 */
export function calculateResultForFeed(
  votingRoundId: number,
  voters: string[],
  feedValues: ValueWithDecimals[],
  weights: bigint[],
  feed: Feed,
  totalVotingWeight: bigint
): MedianCalculationResult {
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

/**
 * Performs specific median calculation for a single feed.
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
    throw new Error("voters, feed values and weights must have the same length");
  }
  const emptyResult = {
    finalMedianPrice: FeedValueEncoder.emptyFeed(decimals),
    quartile1Price: FeedValueEncoder.emptyFeed(decimals),
    quartile3Price: FeedValueEncoder.emptyFeed(decimals),
    participatingWeight: 0n,
  };

  if (voters.length === 0) {
    return emptyResult;
  }
  // assert decimal values are matching
  for (const feedValue of feedValues) {
    if (feedValue.decimals !== decimals) {
      throw new Error("Critical error: Feed value decimals do not match feed decimals");
    }
  }

  const voteData = repack(voters, feedValues, weights).filter(voteDataItem => !voteDataItem.feedValue.isEmpty);
  if (voteData.length === 0) {
    return emptyResult;
  }
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
