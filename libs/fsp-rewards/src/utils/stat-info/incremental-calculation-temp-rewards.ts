import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path/posix";
import { IRewardClaim } from "../RewardClaim";
import { bigIntReplacer } from "../../../../ftso-core/src/utils/big-number-serialization";
import { deserializeAggregatedClaimsForVotingRoundId } from "./aggregated-claims";
import { TEMPORARY_INCREMENTAL_REWARDS_FILE } from "./constants";
import { deserializeRewardEpochInfo } from "./reward-epoch-info";
import { CALCULATIONS_FOLDER } from "../../constants";

import { FullVoterRegistrationInfo } from "../../../../ftso-core/src/data/FullVoterRegistrationInfo";

export interface VoterRewards {
  voter: FullVoterRegistrationInfo;
  aggregatedClaims: IRewardClaim[];
}

export interface IncrementalCalculationsTempRewards {
  rewardEpochId: number;
  votingRoundId: number;
  voterRewards: VoterRewards[];
  otherRewards: IRewardClaim[];
}

export function getIncrementalCalculationsTempRewards(
  rewardEpochId: number,
  votingRoundId: number
): IncrementalCalculationsTempRewards {
  const rewardEpochInfo = deserializeRewardEpochInfo(rewardEpochId);
  const aggregatedClaims = deserializeAggregatedClaimsForVotingRoundId(rewardEpochId, votingRoundId);
  const addressBeneficiaryToVoterId = new Map<string, number>();
  const nodeIdBeneficiaryToVoterId = new Map<string, number>();
  const voterIdToClaims = new Map<number, IRewardClaim[]>();
  for (let i = 0; i < rewardEpochInfo.voterRegistrationInfo.length; i++) {
    const voterRegInfo = rewardEpochInfo.voterRegistrationInfo[i];
    addressBeneficiaryToVoterId.set(voterRegInfo.voterRegistered.signingPolicyAddress.toLowerCase(), i);
    addressBeneficiaryToVoterId.set(voterRegInfo.voterRegistered.voter.toLowerCase(), i);
    addressBeneficiaryToVoterId.set(voterRegInfo.voterRegistrationInfo.delegationAddress.toLowerCase(), i);
    for (const nodeId of voterRegInfo.voterRegistrationInfo.nodeIds) {
      nodeIdBeneficiaryToVoterId.set(nodeId.toLowerCase(), i);
    }
  }
  for (const claim of aggregatedClaims) {
    let voterId = addressBeneficiaryToVoterId.get(claim.beneficiary.toLowerCase());
    if (voterId !== undefined) {
      const claims = voterIdToClaims.get(voterId) || [];
      voterIdToClaims.set(voterId, claims);
      claims.push(claim);
      continue;
    }
    voterId = nodeIdBeneficiaryToVoterId.get(claim.beneficiary.toLowerCase());
    if (voterId !== undefined) {
      const claims = voterIdToClaims.get(voterId) || [];
      voterIdToClaims.set(voterId, claims);
      claims.push(claim);
      continue;
    }
    const claims = voterIdToClaims.get(-1) || [];
    voterIdToClaims.set(-1, claims);
    claims.push(claim);
  }

  const voterRewards: VoterRewards[] = [];
  for (let i = 0; i < rewardEpochInfo.voterRegistrationInfo.length; i++) {
    const voterReward: VoterRewards = {
      voter: rewardEpochInfo.voterRegistrationInfo[i],
      aggregatedClaims: voterIdToClaims.get(i) || [],
    };
    voterRewards.push(voterReward);
  }

  const result: IncrementalCalculationsTempRewards = {
    rewardEpochId,
    votingRoundId,
    voterRewards,
    otherRewards: voterIdToClaims.get(-1) || [],
  };
  return result;
}

/**
 * Serializes reward epoch info to disk.
 * In particular it stores the info in
 *  `<calculationsFolder>/<rewardEpochId>/REWARD_EPOCH_INFO_FILE`
 */
export function serializeIncrementalCalculationsTempRewards(
  rewards: IncrementalCalculationsTempRewards,
  calculationFolder = CALCULATIONS_FOLDER()
): void {
  if (!existsSync(calculationFolder)) {
    mkdirSync(calculationFolder);
  }
  const rewardEpochFolder = path.join(calculationFolder, `${rewards.rewardEpochId}`);
  if (!existsSync(rewardEpochFolder)) {
    mkdirSync(rewardEpochFolder);
  }
  const rewardsFile = path.join(rewardEpochFolder, TEMPORARY_INCREMENTAL_REWARDS_FILE);
  writeFileSync(rewardsFile, JSON.stringify(rewards, bigIntReplacer));
}
