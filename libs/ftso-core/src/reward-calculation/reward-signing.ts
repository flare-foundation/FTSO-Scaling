import { ProtocolMessageMerkleRoot } from "../../../fsp-utils/src/ProtocolMessageMerkleRoot";
import { ISignaturePayload } from "../../../fsp-utils/src/SignaturePayload";
import { GenericSubmissionData } from "../IndexerClient";
import {
  EPOCH_SETTINGS,
  FTSO2_PROTOCOL_ID,
  MINIMAL_REWARDED_NON_CONSENSUS_DEPOSITED_SIGNATURES_PER_HASH_BIPS,
  TOTAL_BIPS,
} from "../configs/networks";
import { IPartialRewardOfferForRound } from "../utils/PartialRewardOffer";
import { ClaimType, IPartialRewardClaim } from "../utils/RewardClaim";
import { SDataForRewardCalculation } from "../utils/stat-info/reward-calculation-data";
import { RewardTypePrefix } from "./RewardTypePrefix";
import { calculateDoubleSigners } from "./reward-double-signers";
import { generateSigningWeightBasedClaimsForVoter } from "./reward-signing-split";
import { isSignatureBeforeTimestamp, isSignatureInGracePeriod } from "./reward-utils";

/**
 * Given an offer and data for reward calculation it calculates signing rewards for the offer.
 * The reward is distributed to signers that deposited signatures in the grace period or before the timestamp of the first successful finalization.
 * If a successful finalization for the votingRoundId does not happen before the end of the voting epoch
 * votingRoundId + 1 + ADDITIONAL_REWARDED_FINALIZATION_WINDOWS, then the data about the finalization does not enter this function.
 * In this case rewards can be still paid out if there is (are) a signed hash which has more than certain percentage of
 * the total weight of the voting weight deposits.
 * TODO: think through whether to reward only in grace period or up to the end of the voting epoch id of votingRoundId + 1.
 */
export function calculateSigningRewards(
  offer: IPartialRewardOfferForRound,
  data: SDataForRewardCalculation,
  addLog = false
): IPartialRewardClaim[] {
  function addInfo(text: string) {
    return addLog
      ? {
          info: `${RewardTypePrefix.SIGNING}: ${text}`,
          votingRoundId,
        }
      : {};
  }

  const votingRoundId = data.dataForCalculations.votingRoundId;
  let rewardEligibleSignatures: GenericSubmissionData<ISignaturePayload>[] = [];
  const doubleSigners = calculateDoubleSigners(
    data.dataForCalculations.votingRoundId,
    FTSO2_PROTOCOL_ID,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    data.signaturesMap!
  );
  if (!data.firstSuccessfulFinalization) {
    const deadlineTimestamp = EPOCH_SETTINGS().votingEpochEndSec(votingRoundId + 1);
    const signatures = mostFrequentHashSignaturesBeforeDeadline(
      votingRoundId,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      data.signaturesMap!,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      data.dataForCalculations.totalSigningWeight!,
      deadlineTimestamp
    );
    if (signatures.length === 0) {
      const backClaim: IPartialRewardClaim = {
        beneficiary: offer.claimBackAddress.toLowerCase(),
        amount: offer.amount,
        claimType: ClaimType.DIRECT,
        ...addInfo("No most frequent signatures"),
        offerIndex: offer.offerIndex,
        feedId: offer.feedId,
      };
      return [backClaim];
    }
    rewardEligibleSignatures = signatures.filter(
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      signature => !doubleSigners.has(signature.messages.signer!.toLowerCase())
    );
  } else {
    const finalizedHash = ProtocolMessageMerkleRoot.hash(
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      data.firstSuccessfulFinalization!.messages.protocolMessageMerkleRoot
    );
    let signatures = data.signaturesMap.get(finalizedHash); // already filtered by hash, votingRoundId, protocolId, eligible signers
    // filter out double signers
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    signatures = signatures.filter(signature => !doubleSigners.has(signature.messages.signer!.toLowerCase()));

    // rewarded:
    // - all signatures in grace period (no matter of finalization timestamp)
    // - signatures outside grace period but before timestamp of first successful finalization, if the timestamp is still within before the
    //   end of the voting epoch id = votingRoundId + 1
    const deadlineTimestamp = Math.min(
      data.firstSuccessfulFinalization.timestamp,
      EPOCH_SETTINGS().votingEpochEndSec(votingRoundId + 1)
    );
    rewardEligibleSignatures = signatures.filter(
      signature =>
        isSignatureInGracePeriod(votingRoundId, signature) ||
        isSignatureBeforeTimestamp(votingRoundId, signature, deadlineTimestamp)
    );
  }
  let undistributedSigningRewardWeight = 0n;
  for (const signature of rewardEligibleSignatures) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    undistributedSigningRewardWeight += BigInt(signature.messages.weight!);
  }

  if (undistributedSigningRewardWeight === 0n) {
    const backClaim: IPartialRewardClaim = {
      beneficiary: offer.claimBackAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
      ...addInfo("no weight of eligible signers"),
      offerIndex: offer.offerIndex,
      feedId: offer.feedId,
    };
    return [backClaim];
  }

  let undistributedAmount = offer.amount;
  const resultClaims: IPartialRewardClaim[] = [];
  // sort signatures according to signing policy order (index in signing policy)
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  rewardEligibleSignatures.sort((a, b) => a.messages.index! - b.messages.index!);

  // assert check for duplicate voter indices
  for (let i = 0; i < rewardEligibleSignatures.length - 1; i++) {
    if (rewardEligibleSignatures[i].messages.index === rewardEligibleSignatures[i + 1].messages.index) {
      throw new Error("Critical error: Duplicate voter index");
    }
  }
  for (const signature of rewardEligibleSignatures) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const weight = BigInt(signature.messages.weight!);
    let amount = 0n;
    if (weight > 0n) {
      // sanity check
      if (undistributedSigningRewardWeight === 0n) {
        throw new Error("Critical error: reward-signing: undistributedSigningRewardWeight must be non-zero");
      }
      // avoiding case when 0 weight voter is the last one
      amount = (weight * undistributedAmount) / undistributedSigningRewardWeight;
    }
    undistributedAmount -= amount;
    undistributedSigningRewardWeight -= weight;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const submitAddress = data.dataForCalculations.signingAddressToSubmitAddress.get(signature.messages.signer!);

    const voterWeights = data.dataForCalculations.votersWeightsMap.get(submitAddress);

    resultClaims.push(
      ...generateSigningWeightBasedClaimsForVoter(amount, offer, voterWeights, RewardTypePrefix.SIGNING, addLog)
    );
  }
  // assert check for undistributed amount
  if (undistributedAmount !== 0n) {
    throw new Error(`Critical error: Undistributed amount is not zero: ${undistributedAmount} of ${offer.amount}`);
  }
  // claim back
  if (resultClaims.length === 0) {
    const backClaim: IPartialRewardClaim = {
      beneficiary: offer.claimBackAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
      ...addInfo("claim back no claims"),
      offerIndex: offer.offerIndex,
      feedId: offer.feedId,
    };
    return [backClaim];
  }
  return resultClaims;
}

/**
 * Calculates most list of signature payload submissions for the most frequent
 * hash of the protocol message merkle root.
 * @param votingRoundId
 * @param signatures
 * @param totalSigningWeight
 * @param deadlineTimestamp
 * @returns
 */
export function mostFrequentHashSignaturesBeforeDeadline(
  votingRoundId: number,
  signatures: Map<string, GenericSubmissionData<ISignaturePayload>[]>,
  totalSigningWeight: number,
  deadlineTimestamp: number,
  protocolId: number = FTSO2_PROTOCOL_ID
): GenericSubmissionData<ISignaturePayload>[] {
  const result: GenericSubmissionData<ISignaturePayload>[] = [];
  let maxWeight = 0;
  const hashToWeight = new Map<string, number>();
  for (const [hash, signatureSubmissions] of signatures.entries()) {
    let weightSum = 0;
    const filteredSubmissions = signatureSubmissions.filter(signatureSubmission =>
      isSignatureBeforeTimestamp(votingRoundId, signatureSubmission, deadlineTimestamp)
    );
    for (const signatureSubmission of filteredSubmissions) {
      if (signatureSubmission.messages.message.protocolId !== protocolId) {
        throw new Error("Critical error: Illegal protocol id");
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      weightSum += signatureSubmission.messages.weight!;
    }
    hashToWeight.set(hash, weightSum);
    if (weightSum > maxWeight) {
      maxWeight = weightSum;
    }
  }
  const minimalWeightThreshold =
    (totalSigningWeight * MINIMAL_REWARDED_NON_CONSENSUS_DEPOSITED_SIGNATURES_PER_HASH_BIPS()) / Number(TOTAL_BIPS);
  for (const [hash, signatureSubmissions] of signatures.entries()) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const weightSum = hashToWeight.get(hash)!;
    if (weightSum === maxWeight && weightSum >= minimalWeightThreshold) {
      const filteredSubmissions = signatureSubmissions.filter(signatureSubmission =>
        isSignatureBeforeTimestamp(votingRoundId, signatureSubmission, deadlineTimestamp)
      );
      result.push(...filteredSubmissions);
    }
  }
  return result;
}
