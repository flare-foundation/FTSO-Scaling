import fs from "fs";
import path from "path/posix";
import { RewardEpoch } from "../../RewardEpoch";
import { CALCULATIONS_FOLDER } from "../../configs/networks";
import { STATUS_FILE } from "./constants";

export enum RewardCalculationStatus {
  PENDING = "PENDING",
  IN_PROGRESS = "IN_PROGRESS",
  DONE = "DONE"
}
export interface RewardEpochCalculationStatus {
  rewardEpochId: number;
  startVotingRoundId: number;
  endVotingRoundId: number;
  calculationStatus: RewardCalculationStatus;
}

/**
 * Returns the initial reward epoch calculation status.
 */
export function initialRewardEpochCalculationStatus(
  rewardEpoch: RewardEpoch,
  endVotingRoundId?: number
): RewardEpochCalculationStatus {
  const status: RewardEpochCalculationStatus = {
    rewardEpochId: rewardEpoch.rewardEpochId,
    startVotingRoundId: rewardEpoch.signingPolicy.startVotingRoundId,
    endVotingRoundId: endVotingRoundId,
    calculationStatus: RewardCalculationStatus.PENDING
  };
  return status;
}

/**
 * Serializes reward epoch calculation status to disk.
 */
export function serializeRewardEpochCalculationStatus(status: RewardEpochCalculationStatus, calculationFolder = CALCULATIONS_FOLDER()) {
  const rewardEpochFolder = path.join(calculationFolder, `${status.rewardEpochId}`);
  const statusFile = path.join(rewardEpochFolder, STATUS_FILE);
  fs.writeFileSync(statusFile, JSON.stringify(status));
}

/**
 * Deserializes reward epoch calculation status from disk.
 */
export function deserializeRewardEpochCalculationStatus(rewardEpochId: number, calculationFolder = CALCULATIONS_FOLDER()): RewardEpochCalculationStatus {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  const statusFile = path.join(rewardEpochFolder, STATUS_FILE);
  return JSON.parse(fs.readFileSync(statusFile, "utf8"));
}

/**
 * Returns true if the reward epoch calculation status file exists.
 */
export function rewardEpochCalculationStatusExists(rewardEpochId: number, calculationFolder = CALCULATIONS_FOLDER()): boolean {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  const statusFile = path.join(rewardEpochFolder, STATUS_FILE);
  return fs.existsSync(statusFile);
}

/**
 * Sets the reward calculation status for a given reward epoch in file.
 */
export function setRewardCalculationStatus(
  rewardEpochId: number,
  status: RewardCalculationStatus,
  rewardEpoch?: RewardEpoch,
  endVotingRoundId?: number
) {
  if (status === RewardCalculationStatus.PENDING) {
    if (!rewardEpoch) {
      throw new Error(`Reward epoch ${rewardEpochId} not found`);
    }
    if (rewardEpochCalculationStatusExists(rewardEpochId)) {
      throw new Error(`Reward calculation status for epoch ${rewardEpochId} already exists`);
    }
    const status = initialRewardEpochCalculationStatus(rewardEpoch, endVotingRoundId);
    serializeRewardEpochCalculationStatus(status);
    return;
  }
  if (status === RewardCalculationStatus.IN_PROGRESS) {
    const readStatus = deserializeRewardEpochCalculationStatus(rewardEpochId);
    if (readStatus.calculationStatus !== RewardCalculationStatus.PENDING) {
      throw new Error(`Reward calculation status for epoch ${rewardEpochId} is not pending`);
    }
    readStatus.calculationStatus = status;
    serializeRewardEpochCalculationStatus(readStatus);
    return;
  }
  if (status === RewardCalculationStatus.DONE) {
    const readStatus = deserializeRewardEpochCalculationStatus(rewardEpochId);
    if (readStatus.calculationStatus !== RewardCalculationStatus.IN_PROGRESS) {
      throw new Error(`Reward calculation status for epoch ${rewardEpochId} is not in progress`);
    }
    readStatus.calculationStatus = status;
    serializeRewardEpochCalculationStatus(readStatus);
    return;
  }
  throw new Error(`Invalid reward calculation status: ${status}`);
}
