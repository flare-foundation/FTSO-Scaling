import { DataForCalculations } from "../data/data-calculation-interfaces";
import { RandomCalculationResult } from "../voting-types";
import { MAX_2_256, NON_BENCHED_RANDOM_VOTERS_MIN_COUNT } from "./ftso-constants";

/**
 * A random is considered safe if
 * - all of the current round reveal offenders are already benched
 * - the number of non-benched offenders that successfully revealed is at least 2
 */
export function calculateRandom(data: DataForCalculations): RandomCalculationResult {
  const nonBenchedOffendersSize = [...data.revealOffenders].filter(
    voter => !data.benchingWindowRevealOffenders.has(voter.toLowerCase())
  ).length;
  let random = 0n;

  let nonBencherCount = 0;
  for (const [voter, revealData] of data.validEligibleReveals) {
    if (!data.benchingWindowRevealOffenders.has(voter)) {
      // only non-benched voters are considered for the random
      // reveal offenders for this round are not in the validEligibleReveals map
      random = random + BigInt(revealData.random);
      nonBencherCount++;
    }
  }
  random = random % MAX_2_256;

  return {
    votingRoundId: data.votingRoundId,
    random: random,
    isSecure: nonBenchedOffendersSize == 0 && nonBencherCount >= NON_BENCHED_RANDOM_VOTERS_MIN_COUNT,
  };
}
