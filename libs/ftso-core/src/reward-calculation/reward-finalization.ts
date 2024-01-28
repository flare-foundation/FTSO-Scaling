import { DataForRewardCalculation } from "../data-calculation-interfaces";
import { RewardEpoch } from "../RewardEpoch";
import { IPartialRewardOffer } from "../utils/PartialRewardOffer";
import { ClaimType, IPartialRewardClaim } from "../utils/RewardClaim";
import { Address } from "../voting-types";
import { TOTAL_BIPS, SIGNING_REWARD_SPLIT_BIPS_TO_STAKE } from "./reward-constants";
import { isFinalizationOutsideOfGracePeriod, isFinalizationInGracePeriodAndEligible } from "./reward-utils";

/**
 * Calculates partial finalization reward claims for the given offer.
 */
export function calculateFinalizationRewardClaims(
  offer: IPartialRewardOffer,
  data: DataForRewardCalculation,
  eligibleFinalizationRewardVotersInGracePeriod: Set<Address>
): IPartialRewardClaim[] {
  if (!data.firstSuccessfulFinalization) {
    const backClaim: IPartialRewardClaim = {
      beneficiary: offer.claimBackAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
    };
    return [backClaim];
  }
  const votingRoundId = data.dataForCalculations.votingRoundId;
  // No voter provided finalization in grace period. Whoever finalizes gets the full reward.
  if (isFinalizationOutsideOfGracePeriod(votingRoundId, data.firstSuccessfulFinalization!)) {
    const backClaim: IPartialRewardClaim = {
      beneficiary: data.firstSuccessfulFinalization!.submitAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
    };
    return [backClaim];
  }
  const gracePeriodFinalizations = data.finalizations.filter(finalization =>
    isFinalizationInGracePeriodAndEligible(votingRoundId, eligibleFinalizationRewardVotersInGracePeriod, finalization)
  );
  if (gracePeriodFinalizations.length === 0) {
    const backClaim: IPartialRewardClaim = {
      beneficiary: data.firstSuccessfulFinalization!.submitAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
    };
    return [backClaim];
  }
  const rewardEpoch = data.dataForCalculations.rewardEpoch;
  let undistributedAmount = offer.amount;
  let undistributedSigningRewardWeight = 0n;
  for (const finalization of gracePeriodFinalizations) {
    const signingAddress = finalization.submitAddress.toLowerCase();
    const weight = rewardEpoch.signerToSigningWeight(signingAddress);
    undistributedSigningRewardWeight += BigInt(weight);
  }
  const resultClaims: IPartialRewardClaim[] = [];
  for (const finalization of gracePeriodFinalizations) {
    const signingAddress = finalization.submitAddress.toLowerCase();
    const weight = BigInt(rewardEpoch.signerToSigningWeight(signingAddress));
    const amount = (weight * offer.amount) / undistributedSigningRewardWeight;
    undistributedAmount -= amount;
    undistributedSigningRewardWeight -= weight;
    resultClaims.push(
      ...generateFinalizationRewardClaimsForVoter(amount, signingAddress, data.dataForCalculations.rewardEpoch)
    );
  }
  return resultClaims;
}

/**
 * Given an amount of a reward it produces specific partial reward claims for finalizations according to here defined split of the reward amount.
 * This includes split to fees and participation rewards.
 */
export function generateFinalizationRewardClaimsForVoter(
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
