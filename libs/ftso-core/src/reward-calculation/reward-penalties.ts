import { VoterWeights } from "../RewardEpoch";
import { DataForRewardCalculation } from "../data-calculation-interfaces";
import { IPartialRewardOffer } from "../utils/PartialRewardOffer";
import { ClaimType, IPartialRewardClaim } from "../utils/RewardClaim";
import { Address } from "../voting-types";
import { PENALTY_FACTOR } from "./reward-constants";
import { rewardDistributionWeight } from "./reward-utils";

/**
 * Given a full reward offer, total rewarded weight and data for reward calculation it calculates penalty claims for reveal withdrawal offenders.
 * The penalty amount is proportional to the weight of the offender.
 */
export function calculateRevealWithdrawalPenalties(
  offer: IPartialRewardOffer,
  revealOffenders: Set<Address>,
  voterWeights: Map<Address, VoterWeights>
): IPartialRewardClaim[] {
  const totalWeight = [...voterWeights.values()]
    .map(voterWeight => rewardDistributionWeight(voterWeight))
    .reduce((a, b) => a + b, 0n);

  return [...revealOffenders].map(submitAddress => {
    const voterWeight = rewardDistributionWeight(voterWeights.get(submitAddress)!);
    const penalty = (-(voterWeight * offer.amount) / totalWeight) * PENALTY_FACTOR;
    const penaltyClaim: IPartialRewardClaim = {
      beneficiary: submitAddress.toLowerCase(),
      amount: penalty,
      claimType: ClaimType.DIRECT,
    };
    return penaltyClaim;
  });
}
