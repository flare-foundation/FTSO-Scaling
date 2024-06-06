import { existsSync, mkdirSync, rmSync } from "fs";
import path from "path/posix";
import { CALCULATIONS_FOLDER } from "../../configs/networks";
import { TEMP_REWARD_EPOCH_FOLDER_PREFIX } from "./constants";

/**
 * Destroys storage for a given reward epoch. It removes the folder.
 */
export function destroyStorage(
  rewardEpochId: number,
  tempRewardEpochFolder = false,
  calculationFolder = CALCULATIONS_FOLDER()
) {
  const rewardEpochFolder = path.join(
    calculationFolder,
    `${tempRewardEpochFolder ? TEMP_REWARD_EPOCH_FOLDER_PREFIX : ""}${rewardEpochId}`
  );
  if (existsSync(rewardEpochFolder)) {
    rmSync(rewardEpochFolder, { recursive: true });
  }
}

export function cleanupVotingRoundFolder(
  rewardEpochId: number,
  votingRoundId: number,
  tempRewardEpochFolder = false,
  calculationFolder = CALCULATIONS_FOLDER()
) {
  const rewardEpochFolder = path.join(
    calculationFolder,
    `${tempRewardEpochFolder ? TEMP_REWARD_EPOCH_FOLDER_PREFIX : ""}${rewardEpochId}`
  );
  const votingRoundFolder = path.join(rewardEpochFolder, `${votingRoundId}`);
  if (existsSync(votingRoundFolder)) {
    rmSync(votingRoundFolder, { recursive: true });
  }
}

export function createVotingRoundFolder(
  rewardEpochId: number,
  votingRoundId: number,
  tempRewardEpochFolder = false,
  calculationFolder = CALCULATIONS_FOLDER()
) {
  const rewardEpochFolder = path.join(
    calculationFolder,
    `${tempRewardEpochFolder ? TEMP_REWARD_EPOCH_FOLDER_PREFIX : ""}${rewardEpochId}`
  );
  const votingRoundFolder = path.join(rewardEpochFolder, `${votingRoundId}`);
  if (!existsSync(votingRoundFolder)) {
    mkdirSync(votingRoundFolder);
  }
}
