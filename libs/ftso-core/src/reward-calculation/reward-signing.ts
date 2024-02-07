import { ProtocolMessageMerkleRoot } from "../../../fsp-utils/src/ProtocolMessageMerkleRoot";
import { ISignaturePayload } from "../../../fsp-utils/src/SignaturePayload";
import { DataForRewardCalculation } from "../data-calculation-interfaces";
import { GenericSubmissionData } from "../IndexerClient";
import { RewardEpoch } from "../RewardEpoch";
import { EPOCH_SETTINGS } from "../configs/networks";
import { IPartialRewardOffer } from "../utils/PartialRewardOffer";
import { ClaimType, IPartialRewardClaim } from "../utils/RewardClaim";
import { Address } from "../voting-types";
import {
  MINIMAL_REWARDED_NON_CONSENSUS_DEPOSITED_SIGNATURES_PER_HASH_BIPS,
  SIGNING_REWARD_SPLIT_BIPS_TO_STAKE,
  TOTAL_BIPS,
} from "./reward-constants";
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
  offer: IPartialRewardOffer,
  data: DataForRewardCalculation
): IPartialRewardClaim[] {
  const votingRoundId = data.dataForCalculations.votingRoundId;
  let rewardEligibleSignatures: GenericSubmissionData<ISignaturePayload>[] = [];
  if (!data.firstSuccessfulFinalization) {
    const deadlineTimestamp = EPOCH_SETTINGS().votingEpochEndSec(votingRoundId + 1);
    const signatures = mostFrequentHashSignaturesBeforeDeadline(
      votingRoundId,
      data.signatures,
      data.dataForCalculations.rewardEpoch.totalSigningWeight,
      deadlineTimestamp
    );
    if (signatures.length === 0) {
      const backClaim: IPartialRewardClaim = {
        beneficiary: offer.claimBackAddress.toLowerCase(),
        amount: offer.amount,
        claimType: ClaimType.DIRECT,
      };
      return [backClaim];
    }
  } else {
    const finalizedHash = ProtocolMessageMerkleRoot.hash(
      data.firstSuccessfulFinalization!.messages.protocolMessageMerkleRoot
    );
    const signatures = data.signatures.get(finalizedHash); // already filtered by hash, votingRoundId, protocolId, eligible signers
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
    undistributedSigningRewardWeight += BigInt(signature.messages.weight!);
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
    const weight = BigInt(signature.messages.weight!);
    const amount = (weight * undistributedAmount) / undistributedSigningRewardWeight;
    undistributedAmount -= amount;
    undistributedSigningRewardWeight -= weight;
    resultClaims.push(
      ...generateSigningRewardClaimsForVoter(amount, signature.messages.signer!, data.dataForCalculations.rewardEpoch)
    );
  }
  // assert check for undistributed amount
  if (undistributedAmount !== 0n) {
    throw new Error(`Critical error: Undistributed amount is not zero: ${undistributedAmount} of ${offer.amount}`);
  }
  // burn everything
  if (resultClaims.length === 0) {
    const backClaim: IPartialRewardClaim = {
      beneficiary: offer.claimBackAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
    };
    return [backClaim];
  }
  return resultClaims;
}

/**
 * Given an amount of a reward it produces specific partial reward claims according to here defined split of the reward amount.
 * This includes split to fees and participation rewards.
 */
export function generateSigningRewardClaimsForVoter(
  amount: bigint,
  signerAddress: Address,
  rewardEpoch: RewardEpoch
): IPartialRewardClaim[] {
  const rewardClaims: IPartialRewardClaim[] = [];
  const fullVoterRegistrationInfo = rewardEpoch.fullVoterRegistrationInfoForSigner(signerAddress);
  const stakingAmount = (amount * SIGNING_REWARD_SPLIT_BIPS_TO_STAKE) / TOTAL_BIPS;
  const delegationAmount = amount - stakingAmount;
  const delegationFee =
    (delegationAmount * BigInt(fullVoterRegistrationInfo.voterRegistrationInfo.delegationFeeBIPS)) / TOTAL_BIPS;
  const delegationBeneficiary = fullVoterRegistrationInfo.voterRegistered.delegationAddress.toLowerCase();
  rewardClaims.push({
    beneficiary: delegationBeneficiary,
    amount: delegationFee,
    claimType: ClaimType.FEE,
  });
  const delegationCommunityReward = delegationAmount - delegationFee;
  rewardClaims.push({
    beneficiary: delegationBeneficiary,
    amount: delegationCommunityReward,
    claimType: ClaimType.WNAT,
  });
  let undistributedStakedWeight = 0n;
  for (let i = 0; i < fullVoterRegistrationInfo.voterRegistrationInfo.nodeIds.length; i++) {
    undistributedStakedWeight += fullVoterRegistrationInfo.voterRegistrationInfo.nodeWeights[i];
  }
  let undistributedStakedAmount = stakingAmount;

  for (let i = 0; i < fullVoterRegistrationInfo.voterRegistrationInfo.nodeIds.length; i++) {
    const nodeId = fullVoterRegistrationInfo.voterRegistrationInfo.nodeIds[i].toLowerCase();
    const weight = fullVoterRegistrationInfo.voterRegistrationInfo.nodeWeights[i];
    const nodeCommunityReward = (weight * undistributedStakedAmount) / undistributedStakedWeight;
    undistributedStakedAmount -= nodeCommunityReward;
    undistributedStakedWeight -= weight;
    // No fees are considered here. Also - no staking fee data on C-chain.
    // In future, if we want to include staking fees, we need to add them here.
    // In current setting, the staking fee would need to be read from P-chain indexer.
    // alternatively, we could use delegation fee here.
    rewardClaims.push({
      beneficiary: nodeId,
      amount: nodeCommunityReward,
      claimType: ClaimType.MIRROR,
    });
  }
  // assert
  if (undistributedStakedAmount !== 0n) {
    throw new Error("Critical error: Undistributed staked amount is not zero");
  }
  return rewardClaims;
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
  deadlineTimestamp: number
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
      weightSum += signatureSubmission.messages.weight!;
    }
    hashToWeight.set(hash, weightSum);
    if (weightSum > maxWeight) {
      maxWeight = weightSum;
    }
  }
  const minimalWeightThreshold =
    (totalSigningWeight * MINIMAL_REWARDED_NON_CONSENSUS_DEPOSITED_SIGNATURES_PER_HASH_BIPS) / Number(TOTAL_BIPS);
  for (const [hash, signatureSubmissions] of signatures.entries()) {
    const weightSum = hashToWeight.get(hash)!;
    if (weightSum >= minimalWeightThreshold) {
      const filteredSubmissions = signatureSubmissions.filter(signatureSubmission =>
        isSignatureBeforeTimestamp(votingRoundId, signatureSubmission, deadlineTimestamp)
      );
      result.push(...filteredSubmissions);
    }
  }
  return result;
}
