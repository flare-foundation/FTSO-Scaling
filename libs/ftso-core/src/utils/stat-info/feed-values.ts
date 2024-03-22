import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path/posix";
import { ContractMethodNames } from "../../configs/contracts";
import { CALCULATIONS_FOLDER, CONTRACTS } from "../../configs/networks";
import { EncodingUtils } from "../EncodingUtils";
import { MerkleTree } from "../MerkleTree";
import { FeedResult, MerkleTreeStructs, RandomResult } from "../MerkleTreeStructs";
import { bigIntReplacer } from "../big-number-serialization";
import { FEED_VALUES_FILE } from "./constants";

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
  calculationFolder = CALCULATIONS_FOLDER()
): void {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  const votingRoundFolder = path.join(rewardEpochFolder, `${votingRoundId}`);
  if (!existsSync(votingRoundFolder)) {
    mkdirSync(votingRoundFolder);
  }
  const feedValuesPath = path.join(votingRoundFolder, FEED_VALUES_FILE);

  const feedValueAbi = EncodingUtils.instance.getFunctionInputAbiData(
    CONTRACTS.FtsoMerkleStructs.name,
    ContractMethodNames.feedStruct,
    0
  ).abi;

  const randomValueAbi = EncodingUtils.instance.getFunctionInputAbiData(
    CONTRACTS.FtsoMerkleStructs.name,
    ContractMethodNames.randomStruct,
    0
  ).abi;
  const randomResult = calculationResults.find(x => !(x as any).id) as RandomResult;
  const feedResults = calculationResults.filter(x => (x as any).id) as FeedResult[];
  if (!randomResult || feedResults.length + 1 !== calculationResults.length) {
    throw new Error("Invalid calculation results!");
  }
  const merkleTree = new MerkleTree([
    MerkleTreeStructs.hashRandomResult(randomResult),
    ...feedResults.map(result => MerkleTreeStructs.hashPriceFeedResult(result)),
  ]);
  const merkleRoot = merkleTree.root;
  const randomValue = {
    body: randomResult,
    merkleProof: merkleTree.getProof(MerkleTreeStructs.hashRandomResult(randomResult)),
  };
  const feedValues = feedResults.map(result => ({
    body: result,
    merkleProof: merkleTree.getProof(MerkleTreeStructs.hashPriceFeedResult(result)),
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
