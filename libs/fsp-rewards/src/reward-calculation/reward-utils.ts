import { ISignaturePayload } from "../../../ftso-core/src/fsp-utils/SignaturePayload";
import { GenericSubmissionData, ParsedFinalizationData } from "../../../ftso-core/src/IndexerClient";
import { VoterWeights } from "../../../ftso-core/src/RewardEpoch";
import {
  EPOCH_SETTINGS,

} from "../../../ftso-core/src/constants";
import { Address } from "../../../ftso-core/src/voting-types";
import {
    GRACE_PERIOD_FOR_FINALIZATION_DURATION_SEC,
    GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC
} from "../constants";
import {FDCEligibleSigner} from "../data-calculation-interfaces";

/**
 * Returns reward distribution weight for the voter.
 */
export function medianRewardDistributionWeight(voterWeights: VoterWeights): bigint {
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
    signatureSubmission.votingEpochIdFromTimestamp == votingRoundId + 1 &&
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
    finalization.votingEpochIdFromTimestamp == votingRoundId + 1 &&
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
