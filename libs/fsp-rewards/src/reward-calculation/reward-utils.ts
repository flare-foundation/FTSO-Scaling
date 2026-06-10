import { ISignaturePayload } from "../../../ftso-core/src/fsp-utils/SignaturePayload";
import { GenericSubmissionData, ParsedFinalizationData } from "../../../ftso-core/src/IndexerClient";
import { VoterWeights } from "../../../ftso-core/src/RewardEpoch";
import { EPOCH_SETTINGS, isFip16Active } from "../../../ftso-core/src/constants";
import { Address } from "../../../ftso-core/src/voting-types";
import { GRACE_PERIOD_FOR_FINALIZATION_DURATION_SEC, GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC } from "../constants";
import { FDCEligibleSigner } from "../data-calculation-interfaces";

/**
 * Returns the weight by which a voter "earns" its share of the FTSO scaling accuracy (median) reward.
 *
 * Before FIP.16 this is the capped C-chain WFLR delegation weight. Once FIP.16 is active for the reward epoch, the
 * earning weight is unified onto the normalized on-chain signing-policy weight (capped delegation + 5x P-chain stake),
 * matching the median consensus weight. The subsequent split of the earned amount between delegators and stakers is
 * handled separately (see {@link generateSigningWeightBasedClaimsForVoter}).
 * See `docs/migrations/FIP-16-signing-weight-unification.md`.
 */
export function medianRewardDistributionWeight(voterWeights: VoterWeights, rewardEpochId: number): bigint {
  if (isFip16Active(rewardEpochId)) {
    return BigInt(voterWeights.signingWeight);
  }
  return voterWeights.cappedDelegationWeight;
}

/**
 * Checks if the signature submission is in grace period of voting round id.
 */
export function isSignatureInGracePeriod(
  votingRoundId: number,
  signatureSubmission: GenericSubmissionData<ISignaturePayload> | FDCEligibleSigner
) {
  return (
    signatureSubmission.votingEpochIdFromTimestamp === votingRoundId + 1 &&
    signatureSubmission.relativeTimestamp >= EPOCH_SETTINGS().revealDeadlineSeconds &&
    signatureSubmission.relativeTimestamp <
      EPOCH_SETTINGS().revealDeadlineSeconds + GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC()
  );
}

/**
 * Checks if the signature submission is before the timestamp.
 */
export function isSignatureBeforeTimestamp(
  votingRoundId: number,
  signatureSubmission: GenericSubmissionData<ISignaturePayload> | FDCEligibleSigner,
  timestamp: number
) {
  return (
    signatureSubmission.votingEpochIdFromTimestamp >= votingRoundId + 1 &&
    signatureSubmission.relativeTimestamp >= EPOCH_SETTINGS().revealDeadlineSeconds &&
    signatureSubmission.timestamp <= timestamp
  );
}

/**
 * Checks if the finalization is in grace period of voting round id and the submitter is eligible for the
 * reward in the grace period.
 */
export function isFinalizationInGracePeriodAndEligible(
  votingRoundId: number,
  eligibleVoters: Set<Address>,
  finalization: ParsedFinalizationData
) {
  return (
    eligibleVoters.has(finalization.submitAddress) &&
    finalization.votingEpochIdFromTimestamp === votingRoundId + 1 &&
    finalization.relativeTimestamp >= EPOCH_SETTINGS().revealDeadlineSeconds &&
    finalization.relativeTimestamp <=
      EPOCH_SETTINGS().revealDeadlineSeconds + GRACE_PERIOD_FOR_FINALIZATION_DURATION_SEC()
  );
}

/**
 * Checks if the finalization is outside of grace period of voting round id.
 */
export function isFinalizationOutsideOfGracePeriod(votingRoundId: number, finalization: ParsedFinalizationData) {
  return (
    finalization.votingEpochIdFromTimestamp >= votingRoundId + 1 &&
    (finalization.votingEpochIdFromTimestamp > votingRoundId + 1 ||
      finalization.relativeTimestamp >
        EPOCH_SETTINGS().revealDeadlineSeconds + GRACE_PERIOD_FOR_FINALIZATION_DURATION_SEC())
  );
}
