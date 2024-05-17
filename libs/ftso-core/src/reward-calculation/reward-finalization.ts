import { IPartialRewardOfferForRound } from "../utils/PartialRewardOffer";
import { ClaimType, IPartialRewardClaim } from "../utils/RewardClaim";
import { SDataForRewardCalculation } from "../utils/stat-info/reward-calculation-data";
import { Address } from "../voting-types";
import { RewardTypePrefix } from "./RewardTypePrefix";
import { generateSigningWeightBasedClaimsForVoter } from "./reward-signing-split";
import { isFinalizationInGracePeriodAndEligible, isFinalizationOutsideOfGracePeriod } from "./reward-utils";

/**
 * Calculates partial finalization reward claims for the given offer.
 */
export function calculateFinalizationRewardClaims(
  offer: IPartialRewardOfferForRound,
  data: SDataForRewardCalculation,
  eligibleFinalizationRewardVotersInGracePeriod: Set<Address>,
  addLog = false
): IPartialRewardClaim[] {
  function addInfo(text: string) {
    return addLog
      ? {
          info: `${RewardTypePrefix.FINALIZATION}: ${text}`,
          votingRoundId: offer.votingRoundId,
        }
      : {};
  }

  if (!data.firstSuccessfulFinalization) {
    const backClaim: IPartialRewardClaim = {
      beneficiary: offer.claimBackAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
      ...addInfo("No finalization"),
      offerIndex: offer.offerIndex,
      feedId: offer.feedId,
    };
    return [backClaim];
  }
  const votingRoundId = data.dataForCalculations.votingRoundId;
  // No voter provided finalization in grace period. Whoever finalizes gets the full reward.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  if (isFinalizationOutsideOfGracePeriod(votingRoundId, data.firstSuccessfulFinalization!)) {
    const otherFinalizerClaim: IPartialRewardClaim = {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      beneficiary: data.firstSuccessfulFinalization!.submitAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
      ...addInfo("outside of grace period"),
      offerIndex: offer.offerIndex,
      feedId: offer.feedId,
    };
    return [otherFinalizerClaim];
  }
  const gracePeriodFinalizations = data.finalizations.filter(finalization =>
    isFinalizationInGracePeriodAndEligible(votingRoundId, eligibleFinalizationRewardVotersInGracePeriod, finalization)
  );
  if (gracePeriodFinalizations.length === 0) {
    const otherFinalizerClaim: IPartialRewardClaim = {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      beneficiary: data.firstSuccessfulFinalization!.submitAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
      ...addInfo("in grace period"),
      offerIndex: offer.offerIndex,
      feedId: offer.feedId,
    };
    return [otherFinalizerClaim];
  }

  let undistributedAmount = offer.amount;
  // The reward should be distributed equally among all the eligible finalizers.
  // Note that each finalizer was chosen by probability corresponding to its relative weight.
  // Consequently, the real weight should not be taken into account here.
  let undistributedSigningRewardWeight = BigInt(eligibleFinalizationRewardVotersInGracePeriod.size);

  const resultClaims: IPartialRewardClaim[] = [];
  for (const finalization of gracePeriodFinalizations) {
    if (!eligibleFinalizationRewardVotersInGracePeriod.has(finalization.submitAddress.toLowerCase())) {
      throw new Error("Critical: finalization submit address must be eligible");
    }
    // submitAddress of finalization === signingAddress for the finalizations in grace period
    const signingAddress = finalization.submitAddress.toLowerCase();

    const submitAddress = data.dataForCalculations.signingAddressToSubmitAddress.get(signingAddress);

    if (!submitAddress) {
      throw new Error("Critical: eligible finalization submit address must be equal to signingAddress of an entity");
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const voterWeight = data.dataForCalculations.votersWeightsMap!.get(submitAddress);

    // sanity check
    if (undistributedSigningRewardWeight === 0n) {
      throw new Error("Critical: reward-finalization: undistributedSigningRewardWeight must be non-zero");
    }
    const amount = undistributedAmount / undistributedSigningRewardWeight;

    undistributedAmount -= amount;
    undistributedSigningRewardWeight -= 1n;
    resultClaims.push(
      ...generateSigningWeightBasedClaimsForVoter(amount, offer, voterWeight, RewardTypePrefix.FINALIZATION, addLog)
    );
  }

  if (undistributedAmount < 0n) {
    throw new Error("Critical: undistributed amount must be positive");
  }
  // claim back for undistributed rewards
  if (undistributedAmount !== 0n) {
    resultClaims.push({
      beneficiary: offer.claimBackAddress.toLowerCase(),
      amount: undistributedAmount,
      claimType: ClaimType.DIRECT,
      ...addInfo("Claim back for undistributed rewards"),
      offerIndex: offer.offerIndex,
      feedId: offer.feedId,
    });
  }
  return resultClaims;
}
