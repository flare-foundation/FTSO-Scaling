import { copyFileSync, existsSync, readFileSync, writeFileSync } from "fs";
import path from "path/posix";
import { ContractMethodNames } from "../../configs/contracts";
import { CALCULATIONS_FOLDER, CONTRACTS, ZERO_BYTES32 } from "../../configs/networks";
import { buildRewardClaimMerkleTree, getMerkleProof } from "../../reward-calculation/reward-merkle-tree";
import { EncodingUtils } from "../EncodingUtils";
import { ClaimType, IRewardClaim, IRewardClaimWithProof } from "../RewardClaim";
import { bigIntReplacer, bigIntReviver } from "../big-number-serialization";
import { REWARD_DISTRIBUTION_DATA_FILE, REWARD_DISTRIBUTION_MIN_CONDITIONS_DATA_FILE } from "./constants";
import Web3 from "web3";

export interface IRewardDistributionData {
  rewardEpochId: number;
  network: string;
  appliedMinConditions?: boolean;
  rewardClaims: IRewardClaimWithProof[];
  noOfWeightBasedClaims: number;
  merkleRoot: string;
  abi: any;
}

/**
 * Serializes reward distribution data for a given reward epoch to disk.
 */
export function serializeRewardDistributionData(
  rewardEpochId: number,
  rewardClaims: IRewardClaim[],
  appliedMinConditions = false,
  calculationFolder = CALCULATIONS_FOLDER()
): void {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  const rewardDistributionDataPath = path.join(rewardEpochFolder, appliedMinConditions ? REWARD_DISTRIBUTION_MIN_CONDITIONS_DATA_FILE : REWARD_DISTRIBUTION_DATA_FILE);
  const abi = EncodingUtils.instance.getFunctionInputAbiData(
    CONTRACTS.ProtocolMerkleStructs.name,
    ContractMethodNames.rewardClaimStruct,
    0
  ).abi; 
  const merkleTree = buildRewardClaimMerkleTree(rewardClaims);
  const merkleRoot = merkleTree.root ?? Web3.utils.keccak256(ZERO_BYTES32);
  const rewardClaimsWithProof = rewardClaims.map(claim => getMerkleProof(claim, merkleTree));
  const noOfWeightBasedClaims = rewardClaims.filter(
    claim =>
      claim.claimType === ClaimType.WNAT || claim.claimType === ClaimType.MIRROR || claim.claimType === ClaimType.CCHAIN
  ).length;
  const result: IRewardDistributionData = {
    rewardEpochId,
    network: process.env.NETWORK!,
    appliedMinConditions,
    rewardClaims: rewardClaimsWithProof,
    noOfWeightBasedClaims,
    merkleRoot,
    abi,
  };
  writeFileSync(rewardDistributionDataPath, JSON.stringify(result, bigIntReplacer));
}

/**
 * Deserializes reward distribution data
 * If applyMinConditions is true, the deserialization is done from REWARD_DISTRIBUTION_MIN_CONDITIONS_DATA_FILE,
 * otherwise it is done from REWARD_DISTRIBUTION_DATA_FILE
 */
export function deserializeRewardDistributionData(
  rewardEpochId: number,
  applyMinConditions = false,
  calculationFolder = CALCULATIONS_FOLDER()
): IRewardDistributionData {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  const rewardDistributionDataPath = path.join(rewardEpochFolder, applyMinConditions ? REWARD_DISTRIBUTION_MIN_CONDITIONS_DATA_FILE : REWARD_DISTRIBUTION_DATA_FILE);
  if (!existsSync(rewardDistributionDataPath)) {
    throw new Error(`Reward distribution data for epoch ${rewardEpochId} does not exist.`);
  }
  const data = JSON.parse(readFileSync(rewardDistributionDataPath, "utf-8"), bigIntReviver) as IRewardDistributionData;
  return data;
}
