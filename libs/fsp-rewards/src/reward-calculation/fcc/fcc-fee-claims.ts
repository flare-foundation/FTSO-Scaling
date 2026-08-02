import { FCC_FEES_ADDRESS } from "../../constants";
import { FCCDataForVotingRound } from "../../data-calculation-interfaces";
import { ClaimType, IPartialRewardClaim } from "../../utils/RewardClaim";
import { RewardTypePrefix } from "../RewardTypePrefix";

/**
 * Protocol tag for FCC reward claims.
 *
 * Deliberately not numeric: FCC has no FSP protocol id, and a non-numeric tag cannot be mistaken for the FDC
 * tag ("200") by consumers that filter on it, such as the minimal conditions checks.
 */
export const FCC_PROTOCOL_TAG = "FCC";

/**
 * Builds the reward claims for the FCC fees paid in a single voting round.
 *
 * Both FCC fee sources are credited to `RewardManager` at the moment they are paid, so every wei observed in these
 * events is part of the funds available for the reward epoch and must appear in exactly one claim. Until the TEE
 * rewarding logic exists, all of it is redirected to `FCC_FEES_ADDRESS`.
 *
 * The two sources are emitted as separate claims so that they stay distinguishable in the partial claim artifacts
 * and reward exports. They share a beneficiary and claim type, so `RewardClaim.merge` collapses them into a single
 * DIRECT claim before the Merkle tree is built.
 */
export function fccFeeClaims(votingRoundId: number, fccData: FCCDataForVotingRound): IPartialRewardClaim[] {
  const claims: IPartialRewardClaim[] = [];
  const beneficiary = FCC_FEES_ADDRESS.toLowerCase();

  const teeFees = fccData.teeInstructions.reduce((total, event) => total + event.fee, 0n);
  if (teeFees > 0n) {
    claims.push({
      votingRoundId,
      beneficiary,
      amount: teeFees,
      claimType: ClaimType.DIRECT,
      protocolTag: FCC_PROTOCOL_TAG,
      rewardTypeTag: RewardTypePrefix.FCC_TEE_FEES,
      rewardDetailTag: "", // no additional tag
    });
  }

  const fdc2Fees = fccData.fdc2AttestationRequests.reduce((total, event) => total + event.fee, 0n);
  if (fdc2Fees > 0n) {
    claims.push({
      votingRoundId,
      beneficiary,
      amount: fdc2Fees,
      claimType: ClaimType.DIRECT,
      protocolTag: FCC_PROTOCOL_TAG,
      rewardTypeTag: RewardTypePrefix.FCC_FDC2_FEES,
      rewardDetailTag: "", // no additional tag
    });
  }

  return claims;
}

/**
 * Total FCC fees observed for a voting round: the sum of both sources.
 *
 * The two sources are disjoint on chain, so this is exactly the amount credited to `RewardManager` by FCC
 * activity in this voting round. Used by the reconciliation to check the claims against the observed funds.
 */
export function totalFccFees(fccData: FCCDataForVotingRound): bigint {
  return (
    fccData.teeInstructions.reduce((total, event) => total + event.fee, 0n) +
    fccData.fdc2AttestationRequests.reduce((total, event) => total + event.fee, 0n)
  );
}
