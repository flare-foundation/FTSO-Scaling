import { FullVoterRegistrationInfo } from "../libs/ftso-core/src/events";
import { verifyWithMerkleProof } from "../libs/ftso-core/src/utils/MerkleTree";
import { RewardClaim } from "../libs/ftso-core/src/utils/RewardClaim";
import { SDataForRewardCalculation, deserializeDataForRewardCalculation } from "../libs/ftso-core/src/utils/stat-info/reward-calculation-data";
import { deserializeRewardDistributionData } from "../libs/ftso-core/src/utils/stat-info/reward-distribution-data";
import { RewardEpochInfo, deserializeRewardEpochInfo } from "../libs/ftso-core/src/utils/stat-info/reward-epoch-info";
import { TestVoter } from "../test/utils/basic-generators";
import { claimSummary } from "../test/utils/reward-claim-summaries";

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
   const mergedClaims = distributionData.rewardClaims.map((claim) => claim.body);
   const voters = getVotersData(rewardEpochId);
   claimSummary(voters, mergedClaims, console);
}

export function verifyMerkleProofs(rewardEpochId: number) {
   const distributionData = deserializeRewardDistributionData(rewardEpochId);
   for (let claimWithProof of distributionData.rewardClaims) {
      const leaf = RewardClaim.hashRewardClaim(claimWithProof.body);
      const result = verifyWithMerkleProof(leaf, claimWithProof.merkleProof, distributionData.merkleRoot);
      if (!result) {
         console.error(`Merkle proof verification failed for claim ${claimWithProof}`);
         return false;
      }
   }
   return true;
}


export async function rewardEpochCalculationData(rewardEpochId: number, endVotingRoundId?: number): Promise<RewardEpochCalculationData> {
   const rewardEpochInfo = deserializeRewardEpochInfo(rewardEpochId);
   const votingRoundIdToRewardCalculationData = new Map<number, SDataForRewardCalculation>();
   if (rewardEpochInfo.endVotingRoundId === undefined && endVotingRoundId === undefined) {
      throw new Error("endRewardEpochId must be specified if rewardEpochInfo.endVotingRoundId is undefined");
   }
   const end = rewardEpochInfo.endVotingRoundId ?? endVotingRoundId!;
   for (let votingRoundId = rewardEpochInfo.signingPolicy.startVotingRoundId; votingRoundId <= end; votingRoundId++) {
      votingRoundIdToRewardCalculationData.set(votingRoundId, deserializeDataForRewardCalculation(rewardEpochId, votingRoundId));
   };
   return {
      rewardEpochInfo,
      votingRoundIdToRewardCalculationData,
      startVotingRoundId: rewardEpochInfo.signingPolicy.startVotingRoundId,
      endVotingRoundId: end
   };
}


