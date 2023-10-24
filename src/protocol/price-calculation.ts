import BN from "bn.js";
import {
  Address,
  EpochResult,
  Feed,
  MedianCalculationResult,
  MedianCalculationSummary,
} from "./voting-types";
import { hashBytes, toBN, unprefixedSymbolBytes } from "./utils/voting-utils";
import Web3 from "web3";
import { MerkleTree } from "./utils/MerkleTree";
import { Bytes32 } from "./utils/sol-types";

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
  let result: VoteData[] = [];
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
  let voteData = repack(voters, prices, weights);
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
  let medianWeight = totalWeight.div(toBN(2)).add(totalWeight.mod(toBN(2)));
  let currentWeightSum = toBN(0);

  let medianPrice: BN | undefined;
  let quartileWeight = totalWeight.div(toBN(4));
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
        let next = voteData[index + 1];
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
