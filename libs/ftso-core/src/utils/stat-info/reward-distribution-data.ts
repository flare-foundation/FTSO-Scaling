import { writeFileSync } from "fs";
import path from "path/posix";
import { ContractMethodNames } from "../../configs/contracts";
import { CALCULATIONS_FOLDER, CONTRACTS } from "../../configs/networks";
import { buildRewardClaimMerkleTree, getMerkleProof } from "../../reward-calculation/reward-merkle-tree";
import { EncodingUtils } from "../EncodingUtils";
import { IRewardClaim, IRewardClaimWithProof } from "../RewardClaim";
import { bigIntReplacer } from "../big-number-serialization";
import { REWARD_DISTRIBUTION_DATA_FILE } from "./constants";

export interface IRewardDistributionData {
  rewardEpochId: number;
  rewardClaims: IRewardClaimWithProof[];
  merkleRoot: string;
  abi: any;
}

/**
 * Serializes reward distribution data for a given reward epoch to disk.
 */
export function serializeRewardDistributionData(
  rewardEpochId: number,
  rewardClaims: IRewardClaim[],
  calculationFolder = CALCULATIONS_FOLDER()
): void {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  const rewardDistributionDataPath = path.join(rewardEpochFolder, REWARD_DISTRIBUTION_DATA_FILE);
  const abi = EncodingUtils.instance.getFunctionInputAbiData(
    CONTRACTS.ProtocolMerkleStructs.name,
    ContractMethodNames.rewardClaimStruct,
    0
  ).abi;
  const merkleTree = buildRewardClaimMerkleTree(rewardClaims);
  const merkleRoot = merkleTree.root;
  const rewardClaimsWithProof = rewardClaims.map(claim => getMerkleProof(claim, merkleTree));
  const result: IRewardDistributionData = {
    rewardEpochId,
    rewardClaims: rewardClaimsWithProof,
    merkleRoot,
    abi,
  };
  writeFileSync(rewardDistributionDataPath, JSON.stringify(result, bigIntReplacer));
}
