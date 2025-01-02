import { VoterWeights } from "../../../ftso-core/src/RewardEpoch";
import { IPartialRewardOfferForRound } from "../utils/PartialRewardOffer";
import { ClaimType, IPartialRewardClaim } from "../utils/RewardClaim";
import { RewardTypePrefix } from "./RewardTypePrefix";
import {CAPPED_STAKING_FEE_BIPS, TOTAL_BIPS} from "../constants";

export enum SigningWeightRewardClaimType {
  NO_VOTER_WEIGHT = "NO_VOTER_WEIGHT",
  FEE_FOR_DELEGATION_AND_STAKING = "FEES_FOR_DELEGATION_AND_STAKING",
  DELEGATION_COMMUNITY_REWARD = "DELEGATION_COMMUNITY_REWARD",
  NODE_COMMUNITY_REWARD = "NODE_COMMUNITY_REWARD",
}

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
  offer: IPartialRewardOfferForRound,
  voterWeights: VoterWeights,
  rewardType: RewardTypePrefix,
  protocolId: number
): IPartialRewardClaim[] {
  const rewardClaims: IPartialRewardClaim[] = [];
  let stakedWeight = 0n;
  for (let i = 0; i < voterWeights.nodeWeights.length; i++) {
    stakedWeight += voterWeights.nodeWeights[i];
  }
  const totalWeight = voterWeights.cappedDelegationWeight + stakedWeight;
  if (totalWeight === 0n) {
    // this should never happen.
    return [
      {
        votingRoundId: offer.votingRoundId,
        beneficiary: offer.claimBackAddress.toLowerCase(),
        amount: amount,
        claimType: ClaimType.DIRECT,
        offerIndex: offer.offerIndex,
        feedId: offer.feedId,
        protocolTag: "" + protocolId,
        rewardTypeTag: rewardType,
        rewardDetailTag: SigningWeightRewardClaimType.NO_VOTER_WEIGHT,
      } as IPartialRewardClaim,
    ];
  }
  const stakingAmount = (amount * stakedWeight) / totalWeight;
  const delegationAmount = amount - stakingAmount;
  const delegationFee = (delegationAmount * BigInt(voterWeights.feeBIPS)) / TOTAL_BIPS;

  const cappedStakingFeeBips = BigInt(Math.min(CAPPED_STAKING_FEE_BIPS, voterWeights.feeBIPS));
  const stakingFee = (stakingAmount * cappedStakingFeeBips) / TOTAL_BIPS;
  const feeBeneficiary = voterWeights.identityAddress.toLowerCase(); //identityAddress
  const delegationBeneficiary = voterWeights.delegationAddress.toLowerCase(); //delegationAddress

  if (delegationFee + stakingFee != 0n) {
    rewardClaims.push({
      votingRoundId: offer.votingRoundId,
      beneficiary: feeBeneficiary,
      amount: delegationFee + stakingFee,
      claimType: ClaimType.FEE,
      offerIndex: offer.offerIndex,
      feedId: offer.feedId,
      protocolTag: "" + protocolId,
      rewardTypeTag: rewardType,
      rewardDetailTag: SigningWeightRewardClaimType.FEE_FOR_DELEGATION_AND_STAKING,
    } as IPartialRewardClaim);
  }

  const delegationCommunityReward = delegationAmount - delegationFee;
  rewardClaims.push({
    votingRoundId: offer.votingRoundId,
    beneficiary: delegationBeneficiary,
    amount: delegationCommunityReward,
    claimType: ClaimType.WNAT,
    offerIndex: offer.offerIndex,
    feedId: offer.feedId,
    protocolTag: "" + protocolId,
    rewardTypeTag: rewardType,
    rewardDetailTag: SigningWeightRewardClaimType.DELEGATION_COMMUNITY_REWARD,
  } as IPartialRewardClaim);
  let undistributedStakedWeight = stakedWeight;
  let undistributedStakedAmount = stakingAmount - stakingFee;

  for (let i = 0; i < voterWeights.nodeIds.length; i++) {
    const nodeId = voterWeights.nodeIds[i].toLowerCase();
    const weight = voterWeights.nodeWeights[i];
    let nodeCommunityReward = 0n;
    if (weight > 0n) {
      // sanity check
      if (undistributedStakedWeight === 0n) {
        throw new Error("Critical error: reward-signing-split: undistributedStakedWeight must be non-zero");
      }
      nodeCommunityReward = (weight * undistributedStakedAmount) / undistributedStakedWeight;
    }
    undistributedStakedAmount -= nodeCommunityReward;
    undistributedStakedWeight -= weight;
    // No fees are considered here. Also - no staking fee data on C-chain.
    // In future, if we want to include staking fees, we need to add them here.
    // In current setting, the staking fee would need to be read from P-chain indexer.
    // alternatively, we could use delegation fee here.
    rewardClaims.push({
      votingRoundId: offer.votingRoundId,
      beneficiary: nodeId,
      amount: nodeCommunityReward,
      claimType: ClaimType.MIRROR,
      offerIndex: offer.offerIndex,
      feedId: offer.feedId,
      protocolTag: "" + protocolId,
      rewardTypeTag: rewardType,
      rewardDetailTag: SigningWeightRewardClaimType.NODE_COMMUNITY_REWARD,
    } as IPartialRewardClaim);
  }
  // assert
  if (undistributedStakedAmount !== 0n) {
    throw new Error("Critical error: Undistributed staked amount is not zero");
  }
  return rewardClaims;
}
