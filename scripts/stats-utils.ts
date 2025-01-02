import { globSync } from "glob";
import { FullVoterRegistrationInfo } from "../libs/contracts/src/events";
import { verifyWithMerkleProof } from "../libs/ftso-core/src/utils/MerkleTree";
import { ClaimType, RewardClaim } from "../libs/fsp-rewards/src/utils/RewardClaim";
import {
  SDataForRewardCalculation,
  deserializeDataForRewardCalculation,
} from "../libs/fsp-rewards/src/utils/stat-info/reward-calculation-data";
import { deserializeRewardDistributionData } from "../libs/fsp-rewards/src/utils/stat-info/reward-distribution-data";
import { RewardEpochInfo, deserializeRewardEpochInfo } from "../libs/fsp-rewards/src/utils/stat-info/reward-epoch-info";
import { TestVoter } from "../test/utils/basic-generators";
import { claimSummary } from "../test/utils/reward-claim-summaries";

import {CALCULATIONS_FOLDER} from "../libs/fsp-rewards/src/constants";

export interface RewardEpochCalculationData {
  rewardEpochInfo: RewardEpochInfo;
  votingRoundIdToRewardCalculationData: Map<number, SDataForRewardCalculation>;
  startVotingRoundId: number;
  endVotingRoundId: number;
}

function fullVoterRegInfoToTestVoterPartial(regInfo: FullVoterRegistrationInfo): TestVoter {
  const result: TestVoter = {
    identityAddress: regInfo.voterRegistered.voter,
    signingAddress: regInfo.voterRegistered.signingPolicyAddress,
    signingPrivateKey: undefined,
    submitAddress: regInfo.voterRegistered.submitAddress,
    submitSignaturesAddress: regInfo.voterRegistered.submitSignaturesAddress,
    delegationAddress: regInfo.voterRegistrationInfo.delegationAddress,
    registrationWeight: undefined,
    wNatCappedWeight: undefined,
    // Unused
    wNatWeight: undefined,
    nodeIds: [],
    nodeWeights: [],
    delegationFeeBIPS: regInfo.voterRegistrationInfo.delegationFeeBIPS,
  };
  return result;
}

function getVotersData(rewardEpochId: number): TestVoter[] {
  const rewardEpochInfo = deserializeRewardEpochInfo(rewardEpochId);
  return rewardEpochInfo.voterRegistrationInfo.map(regInfo => fullVoterRegInfoToTestVoterPartial(regInfo));
}

export function printClaimSummary(rewardEpochId: number) {
  const distributionData = deserializeRewardDistributionData(rewardEpochId);
  const mergedClaims = distributionData.rewardClaims.map(claim => claim.body);
  const voters = getVotersData(rewardEpochId);
  claimSummary(voters, mergedClaims, console);
}

export function verifyMerkleProofs(rewardEpochId: number) {
  const distributionData = deserializeRewardDistributionData(rewardEpochId);
  let weightBasedCount = 0;
  let totalValue = 0n;
  for (const claimWithProof of distributionData.rewardClaims) {
    if(claimWithProof.body.claimType === ClaimType.MIRROR || claimWithProof.body.claimType === ClaimType.WNAT) {
      weightBasedCount++;
    }
    totalValue += claimWithProof.body.amount;
    const leaf = RewardClaim.hashRewardClaim(claimWithProof.body);
    const result = verifyWithMerkleProof(leaf, claimWithProof.merkleProof, distributionData.merkleRoot);
    if (!result) {
      console.error(`Merkle proof verification failed for claim ${claimWithProof}`);
      return false;
    }
  }
  if(weightBasedCount !== distributionData.noOfWeightBasedClaims) {
    console.error(`Weight based claims count mismatch: ${weightBasedCount} vs ${distributionData.noOfWeightBasedClaims}`);
    return false;
  }
  console.log(`Total value: ${totalValue}`);
  return true;
}

export async function rewardEpochCalculationData(
  rewardEpochId: number,
  endVotingRoundId?: number
): Promise<RewardEpochCalculationData> {
  const rewardEpochInfo = deserializeRewardEpochInfo(rewardEpochId);
  const votingRoundIdToRewardCalculationData = new Map<number, SDataForRewardCalculation>();
  let end = rewardEpochInfo.endVotingRoundId ?? endVotingRoundId;
  if (end === undefined) {
    end = rewardEpochInfo.expectedEndVotingRoundId;
    console.log(`Using expected end voting round id: ${end}`);
  }
  for (let votingRoundId = rewardEpochInfo.signingPolicy.startVotingRoundId; votingRoundId <= end; votingRoundId++) {
    try {
      const data = deserializeDataForRewardCalculation(rewardEpochId, votingRoundId);
      votingRoundIdToRewardCalculationData.set(votingRoundId, data);
    } catch (e) {
      console.error(`Error while deserializing data for voting round ${votingRoundId}: ${e}`);
      break;
    }
  }
  return {
    rewardEpochInfo,
    votingRoundIdToRewardCalculationData,
    startVotingRoundId: rewardEpochInfo.signingPolicy.startVotingRoundId,
    endVotingRoundId: end,
  };
}

export function latestRewardEpochIdWithCalculatedData(calculationFolder = CALCULATIONS_FOLDER()) {
  const numberExtractRegex = new RegExp(`^.*\/(\\d+)$`);
  const result = globSync(`${calculationFolder}/*`).map(file => parseInt(file.replace(numberExtractRegex, "$1")));
  const latest = Math.max(...result);
  return latest;
}
