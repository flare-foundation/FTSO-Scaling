import { toBN } from "../test-utils/utils/test-helpers";
import { MedianCalculationSummary } from "./voting-interfaces";

const TOTAL_PPM = 1000000;
/**
 * Data for a single vote.
 */
export interface VoteData {
  voter: string;
  price: BN;
  weight: BN;
  initialIndex: number;
}

/**
 * Repacks voters, prices and weights into a single array of VoteData.
 * All arrays must have the same length.
 * @param voters 
 * @param prices 
 * @param weights 
 * @returns 
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
      initialIndex: i
    });
  }
  return result;
}

/**
 * Given a list of voters, prices and weights, it calculates the median and other statistics.
 * @param voters 
 * @param prices 
 * @param weights 
 * @param elasticBandWidthPPM 
 * @returns 
 */
export function calculateMedian(voters: string[], prices: BN[], weights: BN[], elasticBandWidthPPM: number): MedianCalculationSummary {
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
  weights.forEach(w => totalWeight = totalWeight.add(w));
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
    if(medianPrice !== undefined && quartile1Price !== undefined) {
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
  let elasticBandDiff = medianPrice!.mul(toBN(elasticBandWidthPPM)).div(toBN(TOTAL_PPM));
  return {
    finalMedianPrice: medianPrice!.toNumber(),
    quartile1Price: quartile1Price!.toNumber(),
    quartile3Price: quartile3Price!.toNumber(),
    lowElasticBandPrice: medianPrice!.sub(elasticBandDiff).toNumber(),
    highElasticBandPrice: medianPrice!.add(elasticBandDiff).toNumber()
  }
}



// export interface MedianCalculationSummary {
//   medianIndex: string;
//   quartile1Index: string;
//   quartile3Index: string;
//   leftSum: string;
//   rightSum: string;
//   medianWeight: string;
//   lowWeightSum: string;
//   rewardedWeightSum: string;
//   highWeightSum: string;
//   finalMedianPrice: string;
//   quartile1Price: string;
//   quartile3Price: string;
//   lowElasticBandPrice: string;
//   highElasticBandPrice: string;
// }
