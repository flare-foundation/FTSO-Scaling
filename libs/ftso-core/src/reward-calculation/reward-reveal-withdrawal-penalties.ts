import { RewardEpoch, VoterWeights } from "../RewardEpoch";
import { PENALTY_FACTOR } from "../configs/networks";
import { IPartialRewardOffer } from "../utils/PartialRewardOffer";
import { IPartialRewardClaim } from "../utils/RewardClaim";
import { Address } from "../voting-types";
import { generateSigningWeightBasedClaimsForVoter } from "./reward-signing-split";
import { medianRewardDistributionWeight } from "./reward-utils";

/**
 * Given a full reward offer, total rewarded weight and data for reward calculation it calculates penalty claims for reveal withdrawal offenders.
 * The penalty amount is proportional to the weight of the offender.
 */
export function calculateRevealWithdrawalPenalties(
  offer: IPartialRewardOffer,
  revealOffenders: Set<Address>,
  rewardEpoch: RewardEpoch,
  addLog = false
): IPartialRewardClaim[] {
  const votersWeights = rewardEpoch.getVotersWeights();
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
