import { FTSO2_PROTOCOL_ID } from "../configs/networks";
import { IPartialRewardOfferForRound } from "../utils/PartialRewardOffer";
import { ClaimType, IPartialRewardClaim } from "../utils/RewardClaim";
import { SDataForRewardCalculation } from "../utils/stat-info/reward-calculation-data";
import { Address } from "../voting-types";
import { RewardTypePrefix } from "./RewardTypePrefix";
import { generateSigningWeightBasedClaimsForVoter } from "./reward-signing-split";
import { isFinalizationInGracePeriodAndEligible, isFinalizationOutsideOfGracePeriod } from "./reward-utils";

export enum FinalizationRewardClaimType {
  NO_FINALIZATION = "NO_FINALIZATION",
  OUTSIDE_OF_GRACE_PERIOD = "OUTSIDE_OF_GRACE_PERIOD",
  FINALIZED_BUT_NO_ELIGIBLE_VOTERS = "FINALIZED_BUT_NO_ELIGIBLE_VOTERS",
  CLAIM_BACK_FOR_UNDISTRIBUTED_REWARDS = "CLAIM_BACK_FOR_UNDISTRIBUTED_REWARDS",
}

/**
 * If true, the rewards that are not eligible for finalization rewards are burned.
 * Otherwise they are redistributed to the eligible finalizers.
 */
const BURN_NON_ELIGIBLE_REWARDS = true;

/**
 * Calculates partial finalization reward claims for the given offer.
 * Finalization rewards are distributed to the finalizers in the set @param eligibleFinalizationRewardVotersInGracePeriod
 * that provided finalization in the grace period (set of signing addresses). They must also meet the con dition of being in
 * the set @param eligibleVoters (set of identity addresses).
 */
export function calculateFinalizationRewardClaims(
  offer: IPartialRewardOfferForRound,
  data: SDataForRewardCalculation,
  eligibleFinalizationRewardVotersInGracePeriod: Set<Address>, // signing addresses of the voters that are eligible for finalization reward
  eligibleVoters: Set<Address> // signing addresses of the voters that are eligible for finalization reward
): IPartialRewardClaim[] {
  if (!data.firstSuccessfulFinalization) {
    const backClaim: IPartialRewardClaim = {
      votingRoundId: offer.votingRoundId,
      beneficiary: offer.claimBackAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
      offerIndex: offer.offerIndex,
      feedId: offer.feedId,
      protocolTag: "" + FTSO2_PROTOCOL_ID,
      rewardTypeTag: RewardTypePrefix.FINALIZATION,
      rewardDetailTag: FinalizationRewardClaimType.NO_FINALIZATION,
    };
    return [backClaim];
  }
  const votingRoundId = data.dataForCalculations.votingRoundId;
  // No voter provided finalization in grace period. Whoever finalizes gets the full reward.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  if (isFinalizationOutsideOfGracePeriod(votingRoundId, data.firstSuccessfulFinalization!)) {
    const otherFinalizerClaim: IPartialRewardClaim = {
      votingRoundId: offer.votingRoundId,
      beneficiary: data.firstSuccessfulFinalization!.submitAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
      offerIndex: offer.offerIndex,
      feedId: offer.feedId,
      protocolTag: "" + FTSO2_PROTOCOL_ID,
      rewardTypeTag: RewardTypePrefix.FINALIZATION,
      rewardDetailTag: FinalizationRewardClaimType.OUTSIDE_OF_GRACE_PERIOD,
    };
    return [otherFinalizerClaim];
  }
  const gracePeriodFinalizations = data.finalizations.filter(finalization =>
    isFinalizationInGracePeriodAndEligible(votingRoundId, eligibleFinalizationRewardVotersInGracePeriod, finalization)
  );
  // Rewarding of first successful finalizations outside of the grace period are already handled above
  // Here we have a successful finalization in grace period, but not from anyone eligible and nobody among
  // the eligible ones provided finalization in grace period.
  if (gracePeriodFinalizations.length === 0 || eligibleVoters.size === 0) {
    const burnClaim: IPartialRewardClaim = {
      votingRoundId: offer.votingRoundId,
      beneficiary: offer.claimBackAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
      offerIndex: offer.offerIndex,
      feedId: offer.feedId,
      protocolTag: "" + FTSO2_PROTOCOL_ID,
      rewardTypeTag: RewardTypePrefix.FINALIZATION,
      rewardDetailTag: FinalizationRewardClaimType.FINALIZED_BUT_NO_ELIGIBLE_VOTERS,
    };
    return [burnClaim];
  }

  let undistributedAmount = offer.amount;
  // The reward should be distributed equally among all the eligible finalizers.
  // Note that each finalizer was chosen by probability corresponding to its relative weight.
  // Consequently, the real weight should not be taken into account here.
  let undistributedSigningRewardWeight = 0n;
  for (const finalizer of eligibleFinalizationRewardVotersInGracePeriod) {
    if (BURN_NON_ELIGIBLE_REWARDS || eligibleVoters.has(finalizer)) {
      undistributedSigningRewardWeight += 1n;
    }
  }

  const resultClaims: IPartialRewardClaim[] = [];
  for (const finalization of gracePeriodFinalizations) {
    if (!eligibleFinalizationRewardVotersInGracePeriod.has(finalization.submitAddress.toLowerCase())) {
      throw new Error("Critical: finalization submit address must be eligible");
    }
    // submitAddress of finalization === signingAddress for the finalizations in grace period
    const signingAddress = finalization.submitAddress.toLowerCase();

    // skip rewarding the finalizer if it is not eligible
    if (!eligibleVoters.has(signingAddress)) {
      continue;
    }

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
      ...generateSigningWeightBasedClaimsForVoter(amount, offer, voterWeight, RewardTypePrefix.FINALIZATION)
    );
  }

  if (undistributedAmount < 0n) {
    throw new Error("Critical: undistributed amount must be positive");
  }
  // claim back for undistributed rewards
  if (undistributedAmount !== 0n) {
    // sanity check
    if (!BURN_NON_ELIGIBLE_REWARDS) {
      throw new Error("Critical: reward-finalization: undistributed amount must be zero when rewards are not burned");
    }
    resultClaims.push({
      votingRoundId: offer.votingRoundId,
      beneficiary: offer.claimBackAddress.toLowerCase(),
      amount: undistributedAmount,
      claimType: ClaimType.DIRECT,
      offerIndex: offer.offerIndex,
      feedId: offer.feedId,
      protocolTag: "" + FTSO2_PROTOCOL_ID,
      rewardTypeTag: RewardTypePrefix.FINALIZATION,
      rewardDetailTag: FinalizationRewardClaimType.CLAIM_BACK_FOR_UNDISTRIBUTED_REWARDS,
    });
  }
  return resultClaims;
}
