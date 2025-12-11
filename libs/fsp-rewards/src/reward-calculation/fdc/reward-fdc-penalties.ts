import { VoterWeights } from "../../../../ftso-core/src/RewardEpoch";
import { IPartialRewardOfferForRound } from "../../utils/PartialRewardOffer";
import { IPartialRewardClaim } from "../../utils/RewardClaim";
import { SDataForRewardCalculation } from "../../utils/stat-info/reward-calculation-data";
import { RewardEpochInfo } from "../../utils/stat-info/reward-epoch-info";
import { Address } from "../../../../ftso-core/src/voting-types";
import { RewardTypePrefix } from "../RewardTypePrefix";
import { generateSigningWeightBasedClaimsForVoter } from "../reward-signing-split";
import { FDC_PROTOCOL_ID } from "../../constants";

/**
 *  * Given a @param offer, @param penaltyFactor and @param votersWeights penalty claims for offenders.
 * The penalty amount is proportional to the weight of the offender.
 */
export function calculateFdcPenalties(
  offer: IPartialRewardOfferForRound,
  rewardEpochInfo: RewardEpochInfo,
  data: SDataForRewardCalculation,
  penaltyFactor: bigint,
  votersWeights: Map<Address, VoterWeights>,
  penaltyType: RewardTypePrefix
): IPartialRewardClaim[] {
  const penaltyClaims: IPartialRewardClaim[] = [];
  if (!data.fdcData.fdcOffenders) {
    return penaltyClaims;
  }
  const totalWeight = BigInt(rewardEpochInfo.signingPolicy.weights.reduce((acc, weight) => acc + weight, 0));

  for (const offender of data.fdcData.fdcOffenders) {
    const voterWeights = votersWeights.get(offender.submissionAddress)!;
    let penalty = 0n;
    if (offender.weight > 0) {
      penalty = (-BigInt(offender.weight) * offer.amount * penaltyFactor) / totalWeight;
    }
    if (penalty < 0n) {
      penaltyClaims.push(
        ...generateSigningWeightBasedClaimsForVoter(penalty, offer, voterWeights, penaltyType, FDC_PROTOCOL_ID)
      );
    }
  }
  return penaltyClaims;
}
