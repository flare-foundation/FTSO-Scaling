import { VoterWeights } from "../RewardEpoch";
import { IPartialRewardOfferForRound } from "../utils/PartialRewardOffer";
import { IPartialRewardClaim } from "../utils/RewardClaim";
import { Address } from "../voting-types";
import { RewardTypePrefix } from "./RewardTypePrefix";
import { generateSigningWeightBasedClaimsForVoter } from "./reward-signing-split";
import { medianRewardDistributionWeight } from "./reward-utils";

/**
 *  * Given a @param offer, @param penaltyFactor and @param votersWeights penalty claims for offenders.
 * The penalty amount is proportional to the weight of the offender.
 * @param offer
 * @param penaltyFactor
 * @param offenders Set of submitAddresses of offenders
 * @param votersWeights
 * @param addLog
 * @param penaltyType For logging
 * @returns
 */
export function calculatePenalties(
  offer: IPartialRewardOfferForRound,
  penaltyFactor: bigint,
  offenders: Set<Address>,
  votersWeights: Map<Address, VoterWeights>,
  addLog = false,
  penaltyType: RewardTypePrefix
): IPartialRewardClaim[] {
  const totalWeight = [...votersWeights.values()]
    .map(voterWeight => medianRewardDistributionWeight(voterWeight))
    .reduce((a, b) => a + b, 0n);

  const penaltyClaims: IPartialRewardClaim[] = [];
  for (const submitAddress of offenders) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const voterWeights = votersWeights.get(submitAddress)!;
    if (!voterWeights) {
      throw new Error("Critical error: Illegal offender");
    }
    const voterWeight = medianRewardDistributionWeight(voterWeights);
    let penalty = 0n;
    if (voterWeight > 0n) {
      // sanity check
      if (totalWeight === 0n) {
        throw new Error("Critical error: reward-penalities: totalWeight must be non-zero");
      }
      penalty = (-voterWeight * offer.amount * penaltyFactor) / totalWeight;
    }
    penaltyClaims.push(...generateSigningWeightBasedClaimsForVoter(penalty, offer, voterWeights, penaltyType, addLog));
  }
  return penaltyClaims;
}
