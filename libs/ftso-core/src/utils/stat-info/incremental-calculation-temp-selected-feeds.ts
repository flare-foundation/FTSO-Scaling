import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path/posix";
import { CALCULATIONS_FOLDER } from "../../configs/networks";
import { Feed } from "../../voting-types";
import { bigIntReplacer } from "../big-number-serialization";
import { TEMPORARY_INCREMENTAL_FEED_SELECTION_FILE } from "./constants";
import { deserializeDataForRewardCalculation } from "./reward-calculation-data";
import { deserializeRewardEpochInfo } from "./reward-epoch-info";

export interface FeedSelection {
  votingRoundId: number;
  feed: Feed;
  secureRandomNumber: string;
}

export interface IncrementalCalculationsFeedSelections {
  rewardEpochId: number;
  lastVotingRoundIdWithSelection: number;
  feedSelections: FeedSelection[];
}

/**
 * Generates the feed selection temporary file for the given reward epoch and voting round.
 * The provider voting round must have the secure random number set.
 */
export function getIncrementalCalculationsFeedSelections(rewardEpochId: number, votingRoundIdWithSecureRewardRandom: number): IncrementalCalculationsFeedSelections {
  const rewardEpochInfo = deserializeRewardEpochInfo(rewardEpochId);
  const feedSelections: FeedSelection[] = [];
  for(let votingRoundId = rewardEpochInfo.signingPolicy.startVotingRoundId; votingRoundId <= votingRoundIdWithSecureRewardRandom; votingRoundId++) {
      const data = deserializeDataForRewardCalculation(rewardEpochId, votingRoundId);
      if(data.nextVotingRoundRandomResult === undefined) {
        throw new Error(`Voting round ${votingRoundId} does not have the secure random number for rewarding set.`);
      }
      const selectedFeed = data.dataForCalculations.feedOrder[Number(BigInt(data.nextVotingRoundRandomResult) % BigInt(data.dataForCalculations.feedOrder.length))];
      const feedSelection: FeedSelection = {
        votingRoundId,
        feed: selectedFeed,
        secureRandomNumber: data.nextVotingRoundRandomResult,
      }
      feedSelections.push(feedSelection);
  }
  const result: IncrementalCalculationsFeedSelections = {
    rewardEpochId,
    lastVotingRoundIdWithSelection: votingRoundIdWithSecureRewardRandom,
    feedSelections,
  }
  return result;
}

/**
 * Serializes incremental feed selections to the file system.
 * In particular it stores the info in
 *  `<calculationsFolder>/<rewardEpochId>/TEMPORARY_INCREMENTAL_FEED_SELECTION_FILE`
 */
export function serializeIncrementalCalculationsFeedSelections(
  feedSelections: IncrementalCalculationsFeedSelections,
  calculationFolder = CALCULATIONS_FOLDER()
): void {
  if (!existsSync(calculationFolder)) {
    mkdirSync(calculationFolder);
  }
  const rewardEpochFolder = path.join(
    calculationFolder,
    `${feedSelections.rewardEpochId}`
  );
  if (!existsSync(rewardEpochFolder)) {
    mkdirSync(rewardEpochFolder);
  }
  const feedSelectionsFile = path.join(rewardEpochFolder, TEMPORARY_INCREMENTAL_FEED_SELECTION_FILE);
  writeFileSync(feedSelectionsFile, JSON.stringify(feedSelections, bigIntReplacer));
}

