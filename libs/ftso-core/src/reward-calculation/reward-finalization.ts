import { sign } from "crypto";
import { DataForRewardCalculation } from "../data-calculation-interfaces";
import { IPartialRewardOffer } from "../utils/PartialRewardOffer";
import { ClaimType, IPartialRewardClaim } from "../utils/RewardClaim";
import { Address } from "../voting-types";
import { generateSigningWeightBasedClaimsForVoter } from "./reward-signing-split";
import { isFinalizationInGracePeriodAndEligible, isFinalizationOutsideOfGracePeriod } from "./reward-utils";

/**
 * Calculates partial finalization reward claims for the given offer.
 */
export function calculateFinalizationRewardClaims(
  offer: IPartialRewardOffer,
  data: DataForRewardCalculation,
  eligibleFinalizationRewardVotersInGracePeriod: Set<Address>,
  addLog = false,
): IPartialRewardClaim[] {
  function addInfo(text: string) {
    return addLog
      ? {
        info: `Finalization: ${text}`,
        votingRoundId: offer.votingRoundId
      }
      : {};
  }

  if (!data.firstSuccessfulFinalization) {
    const backClaim: IPartialRewardClaim = {
      beneficiary: offer.claimBackAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
      ...addInfo("No finalization"),
    };
    return [backClaim];
  }
  const votingRoundId = data.dataForCalculations.votingRoundId;
  // No voter provided finalization in grace period. Whoever finalizes gets the full reward.
  if (isFinalizationOutsideOfGracePeriod(votingRoundId, data.firstSuccessfulFinalization!)) {
    const otherFinalizerClaim: IPartialRewardClaim = {
      beneficiary: data.firstSuccessfulFinalization!.submitAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
      ...addInfo("outside of grace period"),
    };
    return [otherFinalizerClaim];
  }
  const gracePeriodFinalizations = data.finalizations.filter(finalization =>
    isFinalizationInGracePeriodAndEligible(votingRoundId, eligibleFinalizationRewardVotersInGracePeriod, finalization)
  );
  if (gracePeriodFinalizations.length === 0) {
    const otherFinalizerClaim: IPartialRewardClaim = {
      beneficiary: data.firstSuccessfulFinalization!.submitAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
      ...addInfo("in grace period"),
    };
    return [otherFinalizerClaim];
  }
  const rewardEpoch = data.dataForCalculations.rewardEpoch;
  let undistributedAmount = offer.amount;
  let undistributedSigningRewardWeight = 0n;

  for (const signingAddress of eligibleFinalizationRewardVotersInGracePeriod) {
    const weight = BigInt(rewardEpoch.signerToSigningWeight(signingAddress));
    undistributedSigningRewardWeight += weight;
  }
  const resultClaims: IPartialRewardClaim[] = [];
  for (const finalization of gracePeriodFinalizations) {
    if (!eligibleFinalizationRewardVotersInGracePeriod.has(finalization.submitAddress.toLowerCase())) {
      throw new Error("Critical: finalization submit address must be eligible");
    }
    // submitAddress === signing address for the finalizations in grace period
    const signingAddress = finalization.submitAddress.toLowerCase();
    const weight = BigInt(rewardEpoch.signerToSigningWeight(signingAddress));
    const amount = (weight * undistributedAmount) / undistributedSigningRewardWeight;

    undistributedAmount -= amount;
    undistributedSigningRewardWeight -= weight;
    resultClaims.push(
      ...generateSigningWeightBasedClaimsForVoter(amount, signingAddress, data.dataForCalculations.rewardEpoch, offer.votingRoundId, "Finalization", addLog)
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
    });
  }
  return resultClaims;
}
