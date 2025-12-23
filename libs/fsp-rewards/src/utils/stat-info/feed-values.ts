import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path/posix";
import { ContractMethodNames } from "../../../../contracts/src/definitions";
import { MerkleTree } from "../../../../ftso-core/src/utils/MerkleTree";
import { FeedResult, MerkleTreeStructs, RandomResult } from "../../../../ftso-core/src/data/MerkleTreeStructs";
import { bigIntReplacer } from "../../../../ftso-core/src/utils/big-number-serialization";
import { FEED_VALUES_FILE, TEMP_REWARD_EPOCH_FOLDER_PREFIX } from "./constants";
import { AbiCache } from "../../../../contracts/src/abi/AbiCache";
import { CALCULATIONS_FOLDER } from "../../constants";
import { CONTRACTS } from "../../../../contracts/src/constants";

export interface FeedResultWithMerkleProof {
  body: FeedResult;
  merkleProof: string[];
}

export interface RandomResultWithMerkleProof {
  body: RandomResult;
  merkleProof: string[];
}

export interface FeedValuesForVotingRoundId {
  votingRoundId: number;
  feedValues: FeedResultWithMerkleProof[];
  randomValue: RandomResultWithMerkleProof;
  merkleRoot: string;
  feedValueAbi: any;
  randomValueAbi: any;
}

/**
 * Serializes median calculation result for a given voting round to disk.
 */
export function serializeFeedValuesForVotingRoundId(
  rewardEpochId: number,
  votingRoundId: number,
  calculationResults: (FeedResult | RandomResult)[],
  tempRewardEpochFolder = false,
  calculationFolder = CALCULATIONS_FOLDER()
): void {
  const rewardEpochFolder = path.join(
    calculationFolder,
    `${tempRewardEpochFolder ? TEMP_REWARD_EPOCH_FOLDER_PREFIX : ""}${rewardEpochId}`
  );
  const votingRoundFolder = path.join(rewardEpochFolder, `${votingRoundId}`);
  if (!existsSync(votingRoundFolder)) {
    mkdirSync(votingRoundFolder);
  }
  const feedValuesPath = path.join(votingRoundFolder, FEED_VALUES_FILE);

  const feedValueAbi = AbiCache.instance.getFunctionInputAbiData(
    CONTRACTS.FtsoMerkleStructs.name,
    ContractMethodNames.feedStruct,
    0
  ).abi;

  const randomValueAbi = AbiCache.instance.getFunctionInputAbiData(
    CONTRACTS.FtsoMerkleStructs.name,
    ContractMethodNames.randomStruct,
    0
  ).abi;
  const randomResult = calculationResults.find((x) => !(x as any).id) as RandomResult;
  const feedResults = calculationResults.filter((x) => (x as any).id) as FeedResult[];
  if (!randomResult || feedResults.length + 1 !== calculationResults.length) {
    throw new Error("Invalid calculation results!");
  }
  const merkleTree = new MerkleTree([
    MerkleTreeStructs.hashRandomResult(randomResult),
    ...feedResults.map((result) => MerkleTreeStructs.hashFeedResult(result)),
  ]);
  const merkleRoot = merkleTree.root;
  const randomValue = {
    body: randomResult,
    merkleProof: merkleTree.getProof(MerkleTreeStructs.hashRandomResult(randomResult)),
  };
  const feedValues = feedResults.map((result) => ({
    body: result,
    merkleProof: merkleTree.getProof(MerkleTreeStructs.hashFeedResult(result)),
  }));

  const result: FeedValuesForVotingRoundId = {
    votingRoundId,
    feedValues,
    randomValue,
    merkleRoot,
    feedValueAbi,
    randomValueAbi,
  };
  writeFileSync(feedValuesPath, JSON.stringify(result, bigIntReplacer));
}
