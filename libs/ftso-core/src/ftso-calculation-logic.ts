import _ from "lodash";
import Web3 from "web3";
import { FeedValueEncoder } from "./utils/FeedEncoder";
import { MerkleTree } from "./utils/MerkleTree";
import { Bytes32 } from "./utils/sol-types";
import {
  combineRandom,
  hashBytes,
  hashForCommit
} from "./utils/voting-utils";
import {
  Address,
  EpochResult,
  Feed,
  MedianCalculationResult,
  MedianCalculationSummary,
  RevealData,
  RevealResult} from "./voting-types";
import { RewardOffers } from "./events/RewardOffers";
const EPOCH_BYTES = 4;
const PRICE_BYTES = 4;
const RANDOM_QUALITY_BYTES = 4;

/**
 * Data for a single vote.
 */
interface VoteData {
  voter: string;
  price: number;
  weight: bigint;
  initialIndex: number;
}

/**
 * Repacks voters, prices and weights into a single array of VoteData.
 * All arrays must have the same length.
 */
function repack(voters: string[], prices: number[], weights: bigint[]): VoteData[] {
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

// TODO: must calculate random number as well using revealWithholders
export async function calculateResults(
  priceEpochId: number,
  commits: Map<Address, string>,
  reveals: Map<string, RevealData>,
  orderedPriceFeeds: Feed[],
  voterWeights: Map<Address, bigint>,
  revealWithholders: Set<Address>  // TODO: implement
): Promise<EpochResult> {
  console.log("Calculating results with commits: ", [...commits.keys()], "reveals", [...reveals.keys()]);
  const revealResult = await calculateRevealers(commits, reveals, voterWeights)!;
  if (revealResult.revealers.length === 0) {
    throw new Error(`No reveals for price epoch: ${priceEpochId}.`);
  }

  const results: MedianCalculationResult[] = await calculateFeedMedians(revealResult, voterWeights, orderedPriceFeeds);

  const random: [Bytes32, boolean] = [
    combineRandom(revealResult.revealedRandoms),
    revealResult.committedFailedReveal.length == 0,
  ];
  return calculateEpochResult(results, random, priceEpochId);
}

export async function calculateRevealers(
  commits: Map<string, string>,
  reveals: Map<string, RevealData>,
  voterWeights: Map<Address, bigint>
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
export function rewardEpochFeedSequence(rewardOffers: RewardOffers): Feed[] {
  interface FeedWithTypeAndValue extends Feed {
    flrValue: bigint;
    isInflation: boolean;
  }

  const feedValues = new Map<string, FeedWithTypeAndValue>();

  for (const inflationOffer of rewardOffers.inflationOffers) {
    for (let i = 0; i < inflationOffer.feedNames.length; i++) {
      let feedValueType = feedValues.get(inflationOffer.feedNames[i]);
      if (feedValueType === undefined) {
        feedValueType = {
          name: inflationOffer.feedNames[i],
          decimals: inflationOffer.decimals[i],
          isInflation: true,
          flrValue: 0n,  // irrelevant for inflation offers
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

  const feedSequence = Array.from(feedValues.values());
  feedSequence.sort((a: FeedWithTypeAndValue, b: FeedWithTypeAndValue) => {
    // sort decreasing by value and on same value increasing by feedId
    if (a.isInflation && !b.isInflation) {
      return -1;
    }
    if (!a.isInflation && b.isInflation) {
      return 1;
    }
    if (a.isInflation && b.isInflation) {
      if(a.name < b.name) {
        return -1;
      }
      if(a.name > b.name) {
        return 1;
      }
      return 0 // should not happen
    }
    // None is from inflation. 
    // Sort decreasing by value and on same value increasing by feedName

    if (a.flrValue < b.flrValue) {
      return 1;
    } 
    if (a.flrValue > b.flrValue) {
      return -1;
    }
    if (a.name < b.name) {
      return -1;
    } 
    if (a.name > b.name) {
      return 1;
    }
    return 0;
  });
  return feedSequence.map(feedValueType => {
    return {
      name: feedValueType.name,
      decimals: feedValueType.decimals,
    };
  })
}

/**
 * Builds a Merkle tree containing price epoch results.
 * The tree is built from the bulk price hash, individual price hashes and the hash of the combined random value.
 * The bulk price hash contains all prices and symbols, and is used for more efficiently retrieving prices for all feeds in the epoch.
 */
export function calculateEpochResult(
  medianResults: MedianCalculationResult[],
  epochRandom: [Bytes32, boolean],
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
  voterWeights: Map<Address, bigint>,
  orderedPriceFeeds: Feed[]
): Promise<MedianCalculationResult[]> {
  const numberOfFeeds = orderedPriceFeeds.length;
  const voters = revealResult.revealers;
  const weights = voters.map(voter => voterWeights.get(voter.toLowerCase())!);

  const feedPrices: number[][] = orderedPriceFeeds.map(() => new Array<number>());
  voters.forEach(voter => {
    const revealData = revealResult.reveals.get(voter.toLowerCase())!;
    const voterPrices = FeedValueEncoder.decode(revealData.encodedPrices, numberOfFeeds);
    voterPrices.forEach((price, i) => feedPrices[i].push(price));
  });

  return orderedPriceFeeds.map((feed, i) => calculateResultsForFeed(voters, feedPrices[i], weights, feed));
}

export function calculateResultsForFeed(voters: string[], prices: number[], weights: bigint[], feed: Feed) {
  const medianSummary = calculateMedian(voters, prices, weights);
  const result: MedianCalculationResult = {
    feed: feed,
    voters: voters,
    prices: prices,
    data: medianSummary,
    weights: weights,
  };
  return result;
}

/**
 * Given a list of voters, prices and weights, it calculates the median and other statistics.
 */
export function calculateMedian(voters: Address[], prices: number[], weights: bigint[]): MedianCalculationSummary {
  const voteData = repack(voters, prices, weights);
  // Sort by price
  voteData.sort((a, b) => {
    if (a.price < b.price) {
      return -1;
    } else if (a.price > b.price) {
      return 1;
    }
    return 0;
  });
  let totalWeight = 0n;
  weights.forEach(w => (totalWeight += w));
  const medianWeight = totalWeight / 2n + totalWeight % 2n;
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
      quartile1Price = vote.price;
    }
    if (medianPrice === undefined && currentWeightSum >= medianWeight) {
      if (currentWeightSum === medianWeight && totalWeight % 2n === 0n) {
        const next = voteData[index + 1];
        // average of two middle prices in even case
        medianPrice = Math.floor((vote.price + next.price) / 2);
      } else {
        medianPrice = vote.price;
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
      quartile3Price = vote.price;
      break;
    }
  }

  return {
    finalMedianPrice: medianPrice,
    quartile1Price: quartile1Price,
    quartile3Price: quartile3Price,
  };
}
