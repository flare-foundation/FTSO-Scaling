import { ethers } from "ethers";
import { Address } from "./voting-types";

export class RandomVoterSelector {
  thresholds: bigint[];
  totalWeight: bigint;
  voters: Address[];
  weights: bigint[];

  constructor(voters: Address[], weights: bigint[]) {
    if (voters.length !== weights.length) {
      throw new Error("voters and weights must have the same length");
    }
    this.voters = [...voters];
    this.weights = [...weights];
    this.totalWeight = 0n;
    for (let weight of weights) {
      this.thresholds.push(this.totalWeight);
      this.totalWeight += weight;
    }
  }

  /**
   * Selects a random voter based provided random number. 
   * Random number is encoded as 32-bytes 0x prefixed hex string. 
   * @returns the selected voter
   */
  selectVoterIndex(randomNumber: string): number {
    if (!randomNumber.startsWith("0x")) {
      throw new Error("Random number must be 0x-prefixed hex string");
    }
    const randomWeight = BigInt(randomNumber) % this.totalWeight;
    const index = this.binarySearch(randomWeight);
    return index
  }

  /**
   * Searches for the highest index of the threshold that is less than or equal to the value.
   * Binary search is used.
   */
  private binarySearch(value: bigint): number {
    let left = 0;
    let right = this.thresholds.length - 1;
    let mid = 0;
    while (left <= right) {
      mid = Math.floor((left + right) / 2);
      if (this.thresholds[mid] < value) {
        left = mid + 1;
      } if(this.thresholds[mid] > value) {
        right = mid;
      } else {
        return mid;
      }
    }
    return left - 1;
  }

  /**
   * Based on initial seed and threshold in BIPS it selects a random set of voters with weight 
   * greater than or equal to the threshold. The threshold is expressed in BIPS (basis points) 
   * of total voter weight. 
   * If the threshold is 0 it randomly selects on voter, with probability proportional to its weight.
   * @param randomSeed 
   * @param thresholdBIPS 
   * @returns 
   */
  public randomSelectThresholdWeightVoters(randomSeed: string, thresholdBIPS: number): Address[] {
    // We limit the threshold to 5000 BIPS to avoid long running loops
    // In practice it will be used with around 1000 BIPS or lower.
    if(thresholdBIPS < 0 || thresholdBIPS > 5000) {
      throw new Error("Threshold must be between 0 and 5000 BIPS");
    }
    let selectedWeight = 0n;
    let thresholdWeight = this.totalWeight * BigInt(thresholdBIPS) / 10000n;
    let currentSeed = randomSeed;
    const selectedVoters = new Set<Address>();

    // If threshold weight is not too big, the loop should end quickly
    while(selectedWeight < thresholdWeight) {
      const index = this.selectVoterIndex(currentSeed);
      const selectedAddress = this.voters[index];
      if (!selectedVoters.has(selectedAddress)) {
        selectedVoters.add(selectedAddress);      
        selectedWeight += this.weights[index];
      }
      currentSeed = ethers.keccak256(currentSeed);      
    }
    return [...selectedVoters];
  }
}
