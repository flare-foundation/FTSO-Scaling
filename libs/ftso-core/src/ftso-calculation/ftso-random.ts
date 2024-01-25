import { DataForCalculations } from "../data-calculation-interfaces";
import { RandomCalculationResult } from "../voting-types";
import { MAX_2_256, NON_BENCHED_RANDOM_VOTERS_MIN_COUNT } from "./ftso-constants";

/**
 * A random is considered safe if
 * - all of the current round reveal offenders are already benched
 * - the number of non-benched offenders that successfully revealed is at least 2
 */
export async function calculateRandom(data: DataForCalculations): Promise<RandomCalculationResult> {
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
