import { RewardEpoch } from "../RewardEpoch";
import { CAPPED_STAKING_FEE_BIPS, TOTAL_BIPS } from "../configs/networks";
import { ClaimType, IPartialRewardClaim } from "../utils/RewardClaim";
import { Address } from "../voting-types";

/**
 * Given an amount of a reward it produces specific partial reward claims split based when reward amount is assigned to
 * a specific voter based on its signing weight.
 * The signing weight is calculated from sum of staked weight and capped delegated weight. Fee that is used is the delegation fee.
 * Hence three types of claims are produced:
 * - fee claim, based on delegation fee
 * - claim for WNAT participation weight
 * - claims for mirror node participation weight.
 * The function also works with negative amount, that being used to calculate penalty claims.
 */
export function generateSigningWeightBasedClaimsForVoter(
  amount: bigint,
  signerAddress: Address,
  rewardEpoch: RewardEpoch,
  votingRoundId: number,
  info: string,
  addLog = false,
): IPartialRewardClaim[] {
  function addInfo(text: string) {
    return addLog
      ? {
        info: `${info}: ${text}`,
        votingRoundId,
      }
      : {};
  }

  const rewardClaims: IPartialRewardClaim[] = [];
  const fullVoterRegistrationInfo = rewardEpoch.fullVoterRegistrationInfoForSigner(signerAddress);
  let stakedWeight = 0n;
  for (let i = 0; i < fullVoterRegistrationInfo.voterRegistrationInfo.nodeWeights.length; i++) {
    stakedWeight += fullVoterRegistrationInfo.voterRegistrationInfo.nodeWeights[i];
  }
  const totalWeight = fullVoterRegistrationInfo.voterRegistrationInfo.wNatCappedWeight + stakedWeight;
  const stakingAmount = (amount * stakedWeight) / totalWeight;
  const delegationAmount = amount - stakingAmount;
  const delegationFee =
    (delegationAmount * BigInt(fullVoterRegistrationInfo.voterRegistrationInfo.delegationFeeBIPS)) / TOTAL_BIPS;
  const cappedStakingFeeBips = BigInt(Math.min(CAPPED_STAKING_FEE_BIPS, fullVoterRegistrationInfo.voterRegistrationInfo.delegationFeeBIPS));
  const stakingFee =
    (stakingAmount * cappedStakingFeeBips) / TOTAL_BIPS;
  const feeBeneficiary = fullVoterRegistrationInfo.voterRegistrationInfo.voter.toLowerCase();
  const delegationBeneficiary = fullVoterRegistrationInfo.voterRegistrationInfo.delegationAddress.toLowerCase();
  rewardClaims.push({
    beneficiary: feeBeneficiary,
    amount: delegationFee + stakingFee,
    claimType: ClaimType.FEE,
    ...addInfo("fee for delegation and staking")
  } as IPartialRewardClaim);

  const delegationCommunityReward = delegationAmount - delegationFee;
  rewardClaims.push({
    beneficiary: delegationBeneficiary,
    amount: delegationCommunityReward,
    claimType: ClaimType.WNAT,
    ...addInfo("delegation community reward")
  } as IPartialRewardClaim);
  let undistributedStakedWeight = stakedWeight;
  let undistributedStakedAmount = stakingAmount - stakingFee;

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
      ...addInfo("node community reward")
    } as IPartialRewardClaim);
  }
  // assert
  if (undistributedStakedAmount !== 0n) {
    throw new Error("Critical error: Undistributed staked amount is not zero");
  }
  return rewardClaims;
}
