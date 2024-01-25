import { DataForRewardCalculation } from "../data-calculation-interfaces";
import { IPartialRewardOffer } from "../utils/PartialRewardOffer";
import { ClaimType, IPartialRewardClaim } from "../utils/RewardClaim";
import { PENALTY_FACTOR } from "./reward-constants";
import { rewardDistributionWeight } from "./reward-utils";

/**
 * Given a full reward offer, total rewarded weight and data for reward calculation it calculates penalty claims for reveal withdrawal offenders.
 * The penalty amount is proportional to the weight of the offender.
 * @param fullOffer
 * @param totalRewardedWeight
 * @param data
 * @returns
 */
export function calculateRevealWithdrawalPenalties(
  fullOffer: IPartialRewardOffer,
  totalRewardedWeight: bigint,
  data: DataForRewardCalculation
): IPartialRewardClaim[] {
  return [...data.dataForCalculations.revealOffenders].map(submitAddress => {
    const voterWeight = rewardDistributionWeight(data.voterWeights.get(submitAddress)!);
    const penalty = -(voterWeight * fullOffer.amount) / totalRewardedWeight * PENALTY_FACTOR;
    const penaltyClaim: IPartialRewardClaim = {
      beneficiary: submitAddress.toLowerCase(),
      amount: penalty,
      claimType: ClaimType.DIRECT,
    };
    return penaltyClaim;
  });
}
