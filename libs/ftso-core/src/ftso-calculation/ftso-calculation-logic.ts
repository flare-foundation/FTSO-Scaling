import { DataForCalculations } from "../data/data-calculation-interfaces";
import { MerkleTree } from "../utils/MerkleTree";
import { MerkleTreeStructs } from "../data/MerkleTreeStructs";
import { EpochResult, MedianCalculationResult, RandomCalculationResult } from "../voting-types";
import { calculateMedianResults } from "./ftso-median";
import { calculateRandom } from "./ftso-random";

/**
 * The main entrypoint for calculating the results of a voting round.
 */
export function calculateResultsForVotingRound(data: DataForCalculations): EpochResult {
  if (data.validEligibleReveals.size === 0) {
    throw Error(`No valid reveals found, unable to calculate results for voting round ${data.votingRoundId}`);
  }
  const results: MedianCalculationResult[] = calculateMedianResults(data);
  const random = calculateRandom(data);
  return prepareResultsForVotingRound(data.votingRoundId, results, random);
}

/**
 * Builds a Merkle tree containing price epoch results.
 * The tree is built from the bulk price hash, individual price hashes and the hash of the combined random value.
 * The bulk price hash contains all prices and symbols, and is used for more efficiently retrieving prices for all feeds in the epoch.
 */
export function prepareResultsForVotingRound(
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
