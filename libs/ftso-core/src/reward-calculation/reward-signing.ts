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
import { Address } from "../voting-types";
import { RewardTypePrefix } from "./RewardTypePrefix";
import { calculateDoubleSigners } from "./reward-double-signers";
import { generateSigningWeightBasedClaimsForVoter } from "./reward-signing-split";
import { isSignatureBeforeTimestamp, isSignatureInGracePeriod } from "./reward-utils";

// Allowing for two options in regard to conditioning rewards on existence of median rewards.
const BURN_NON_ELIGIBLE_REWARDS = true;

export enum SigningRewardClaimType {
  NO_MOST_FREQUENT_SIGNATURES = "NO_MOST_FREQUENT_SIGNATURES",
  NO_WEIGHT_OF_ELIGIBLE_SIGNERS = "NO_WEIGHT_OF_ELIGIBLE_SIGNERS",
  CLAIM_BACK_DUE_TO_NON_ELIGIBLE_SIGNER = "CLAIM_BACK_DUE_TO_NON_ELIGIBLE_SIGNER",
  CLAIM_BACK_NO_CLAIMS = "CLAIM_BACK_NO_CLAIMS",
  NO_TIMELY_FINALIZATION = "NO_TIMELY_FINALIZATION",
  CLAIM_BACK_OF_NON_SIGNERS_SHARE = "CLAIM_BACK_OF_NON_SIGNERS_SHARE",
  NON_DOMINATING_BITVOTE = "NON_DOMINATING_BITVOTE", 
  EMPTY_BITVOTE = "EMPTY_BITVOTE",
}
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
  eligibleVoters: Set<Address>
): IPartialRewardClaim[] {
  const votingRoundId = data.dataForCalculations.votingRoundId;
  let rewardEligibleSignatures: GenericSubmissionData<ISignaturePayload>[] = [];
  const doubleSigners = calculateDoubleSigners(
    data.dataForCalculations.votingRoundId,
    FTSO2_PROTOCOL_ID,
    data.signaturesMap!
  );
  if (!data.firstSuccessfulFinalization) {
    const deadlineTimestamp = EPOCH_SETTINGS().votingEpochEndSec(votingRoundId + 1);
    const signatures = mostFrequentHashSignaturesBeforeDeadline(
      votingRoundId,
      data.signaturesMap!,
      data.dataForCalculations.totalSigningWeight!,
      deadlineTimestamp
    );
    if (signatures.length === 0) {
      const backClaim: IPartialRewardClaim = {
        votingRoundId,
        beneficiary: offer.claimBackAddress.toLowerCase(),
        amount: offer.amount,
        claimType: ClaimType.DIRECT,
        offerIndex: offer.offerIndex,
        feedId: offer.feedId,
        protocolTag: "" + FTSO2_PROTOCOL_ID,
        rewardTypeTag: RewardTypePrefix.SIGNING,
        rewardDetailTag: SigningRewardClaimType.NO_MOST_FREQUENT_SIGNATURES,
      };
      return [backClaim];
    }
    rewardEligibleSignatures = signatures.filter(
      signature => !doubleSigners.has(signature.messages.signer!.toLowerCase())
    );
  } else {
    const finalizedHash = ProtocolMessageMerkleRoot.hash(
      data.firstSuccessfulFinalization!.messages.protocolMessageMerkleRoot
    );
    let signatures = data.signaturesMap.get(finalizedHash); // already filtered by hash, votingRoundId, protocolId, eligible signers
    // filter out double signers
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
    const signer = signature.messages.signer!.toLowerCase();
    const weight = signature.messages.weight!;
    if (!BURN_NON_ELIGIBLE_REWARDS && !eligibleVoters.has(signer)) {
      // redistribute the reward to eligible voters by not including the weight
      continue;
    }
    undistributedSigningRewardWeight += BigInt(weight);
  }

  if (undistributedSigningRewardWeight === 0n) {
    const backClaim: IPartialRewardClaim = {
      votingRoundId,
      beneficiary: offer.claimBackAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
      offerIndex: offer.offerIndex,
      feedId: offer.feedId,
      protocolTag: "" + FTSO2_PROTOCOL_ID,
      rewardTypeTag: RewardTypePrefix.SIGNING,
      rewardDetailTag: SigningRewardClaimType.NO_WEIGHT_OF_ELIGIBLE_SIGNERS,
    };
    return [backClaim];
  }

  let undistributedAmount = offer.amount;
  const resultClaims: IPartialRewardClaim[] = [];
  // sort signatures according to signing policy order (index in signing policy)
  rewardEligibleSignatures.sort((a, b) => a.messages.index! - b.messages.index!);

  // assert check for duplicate voter indices
  for (let i = 0; i < rewardEligibleSignatures.length - 1; i++) {
    if (rewardEligibleSignatures[i].messages.index === rewardEligibleSignatures[i + 1].messages.index) {
      throw new Error("Critical error: Duplicate voter index");
    }
  }
  for (const signature of rewardEligibleSignatures) {
    const signer = signature.messages.signer!.toLowerCase();
    if (!BURN_NON_ELIGIBLE_REWARDS && !eligibleVoters.has(signer)) {
      // ignore non-eligible voters in reward distribution when not burning the claims
      continue;
    }
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

    const submitAddress = data.dataForCalculations.signingAddressToSubmitAddress.get(signer);

    const voterWeights = data.dataForCalculations.votersWeightsMap.get(submitAddress);
    if (BURN_NON_ELIGIBLE_REWARDS && !eligibleVoters.has(signer)) {
      // create burn claims for non-eligible voters
      const backClaim: IPartialRewardClaim = {
        votingRoundId,
        beneficiary: offer.claimBackAddress.toLowerCase(),
        amount: amount,
        claimType: ClaimType.DIRECT,
        offerIndex: offer.offerIndex,
        feedId: offer.feedId,
        protocolTag: "" + FTSO2_PROTOCOL_ID,
        rewardTypeTag: RewardTypePrefix.SIGNING,
        rewardDetailTag: SigningRewardClaimType.CLAIM_BACK_DUE_TO_NON_ELIGIBLE_SIGNER,
        burnedForVoter: signer,
      };
      resultClaims.push(backClaim);
    } else {
      resultClaims.push(
        ...generateSigningWeightBasedClaimsForVoter(amount, offer, voterWeights, RewardTypePrefix.SIGNING, FTSO2_PROTOCOL_ID)
      );
    }
  }
  // assert check for undistributed amount
  if (undistributedAmount !== 0n) {
    throw new Error(`Critical error: Undistributed amount is not zero: ${undistributedAmount} of ${offer.amount}`);
  }
  // claim back
  if (resultClaims.length === 0) {
    const backClaim: IPartialRewardClaim = {
      votingRoundId,
      beneficiary: offer.claimBackAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
      offerIndex: offer.offerIndex,
      feedId: offer.feedId,
      protocolTag: "" + FTSO2_PROTOCOL_ID,
      rewardTypeTag: RewardTypePrefix.SIGNING,
      rewardDetailTag: SigningRewardClaimType.CLAIM_BACK_NO_CLAIMS,
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
