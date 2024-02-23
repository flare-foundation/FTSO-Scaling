import fs from "fs";
import path from "path/posix";
import { CALCULATIONS_FOLDER } from "../../configs/networks";
import { bigIntReplacer, bigIntReviver } from "../big-number-serialization";
import { FeedResult, RandomResult } from "../MerkleTreeStructs";
import { FEED_VALUES_FILE } from "./constants";

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
  if (!fs.existsSync(votingRoundFolder)) {
    fs.mkdirSync(votingRoundFolder);
  }
  const feedValuesPath = path.join(votingRoundFolder, FEED_VALUES_FILE);
  fs.writeFileSync(feedValuesPath, JSON.stringify(calculationResults, bigIntReplacer));
}

/**
 * Deserializes median calculation result for a given voting round from disk.
 */
export function deserializeFeedValuesForVotingRoundId(
  rewardEpochId: number,
  votingRoundId: number,
  calculationFolder = CALCULATIONS_FOLDER()
): (FeedResult | RandomResult)[] {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  const votingRoundFolder = path.join(rewardEpochFolder, `${votingRoundId}`);
  const feedValuesPath = path.join(votingRoundFolder, FEED_VALUES_FILE);
  return JSON.parse(fs.readFileSync(feedValuesPath, "utf8"), bigIntReviver);
}
