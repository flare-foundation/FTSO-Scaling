import { VoterWeights } from "../RewardEpoch";
import { PENALTY_FACTOR } from "../configs/networks";
import { IPartialRewardOffer } from "../utils/PartialRewardOffer";
import { IPartialRewardClaim } from "../utils/RewardClaim";
import { Address } from "../voting-types";
import { generateSigningWeightBasedClaimsForVoter } from "./reward-signing-split";
import { medianRewardDistributionWeight } from "./reward-utils";

/**
 * Given a full reward offer, total rewarded weight and data for reward calculation it calculates penalty claims for reveal withdrawal offenders.
 * The penalty amount is proportional to the weight of the offender.
 * @param offer
 * @param revealOffenders A set of submitAddresses of reveal offenders. A reveal offender is always a registered voter.
 * @param votersWeights Mapping from submitAddress of a registered voter to their Weights and addresses of registered voters.
 * @param addLog
 * @returns
 */
export function calculateRevealWithdrawalPenalties(
  offer: IPartialRewardOffer,
  revealOffenders: Set<Address>,
  votersWeights: Map<Address, VoterWeights>,
  addLog = false
): IPartialRewardClaim[] {
  const totalWeight = [...votersWeights.values()]
    .map(voterWeight => medianRewardDistributionWeight(voterWeight))
    .reduce((a, b) => a + b, 0n);

  const penaltyClaims: IPartialRewardClaim[] = [];
  for (const submitAddress of revealOffenders) {
    const voterWeights = votersWeights.get(submitAddress)!;
    if (!voterWeights) {
      throw new Error("Critical error: Illegal offender");
    }
    const voterWeight = medianRewardDistributionWeight(voterWeights);
    const penalty = (-voterWeight * offer.amount * PENALTY_FACTOR()) / totalWeight;
    penaltyClaims.push(
      ...generateSigningWeightBasedClaimsForVoter(
        penalty,
        voterWeights,
        offer.votingRoundId,
        "Reveal withdrawal",
        addLog
      )
    );
  }
  return penaltyClaims;
}
