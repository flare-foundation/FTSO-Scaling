import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path/posix";
import { ContractMethodNames } from "../../../../contracts/src/definitions";
import { ZERO_BYTES32 } from "../../../../ftso-core/src/constants";
import { buildRewardClaimMerkleTree, getMerkleProof } from "../../reward-calculation/reward-merkle-tree";
import { ClaimType, IRewardClaim, IRewardClaimWithProof } from "../RewardClaim";
import { bigIntReplacer, bigIntReviver } from "../../../../ftso-core/src/utils/big-number-serialization";
import { REWARD_DISTRIBUTION_DATA_FILE } from "./constants";
import Web3 from "web3";
import {AbiCache} from "../../../../contracts/src/abi/AbiCache";
import {CALCULATIONS_FOLDER} from "../../constants";
import {CONTRACTS} from "../../../../contracts/src/constants";

export interface IRewardDistributionData {
  rewardEpochId: number;
  network: string;
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
  calculationFolder = CALCULATIONS_FOLDER()
): void {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  const rewardDistributionDataPath = path.join(rewardEpochFolder, REWARD_DISTRIBUTION_DATA_FILE);
  const abi = AbiCache.instance.getFunctionInputAbiData(
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
    rewardClaims: rewardClaimsWithProof,
    noOfWeightBasedClaims,
    merkleRoot,
    abi,
  };
  writeFileSync(rewardDistributionDataPath, JSON.stringify(result, bigIntReplacer));
}

export function deserializeRewardDistributionData(
  rewardEpochId: number,
  calculationFolder = CALCULATIONS_FOLDER()
): IRewardDistributionData {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  const rewardDistributionDataPath = path.join(rewardEpochFolder, REWARD_DISTRIBUTION_DATA_FILE);
  if (!existsSync(rewardDistributionDataPath)) {
    throw new Error(`Reward distribution data for epoch ${rewardEpochId} does not exist.`);
  }
  const data = JSON.parse(readFileSync(rewardDistributionDataPath, "utf-8"), bigIntReviver) as IRewardDistributionData;
  return data;
}
