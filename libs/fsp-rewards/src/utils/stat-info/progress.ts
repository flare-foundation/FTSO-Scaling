import { writeFileSync } from "fs";
import { globSync } from "glob";
import path from "path/posix";
import {
  AGGREGATED_CLAIMS_FILE,
  CLAIMS_FILE,
  CLAIM_AGGREGATION_PROGRESS_FILE,
  CLAIM_CALCULATION_PROGRESS_FILE,
  FEED_CALCULATION_PROGRESS_FILE,
  FEED_VALUES_FILE,
  OFFERS_FILE,
  OFFER_DISTRIBUTION_PROGRESS_FILE,
  TEMP_REWARD_EPOCH_FOLDER_PREFIX,
} from "./constants";
import { RewardCalculationStatus, deserializeRewardEpochCalculationStatus } from "./reward-calculation-status";
import { CALCULATIONS_FOLDER } from "../../constants";

export enum ProgressType {
  OFFER_DISTRIBUTION = "OFFER_DISTRIBUTION",
  FEED_CALCULATION = "FEED_CALCULATION",
  CLAIM_CALCULATION = "CLAIM_CALCULATION",
  CLAIM_AGGREGATION = "CLAIM_AGGREGATION",
}

export interface ProgressReport {
  startVotingRoundId: number;
  endVotingRoundId: number;
  sequential: boolean;
  status: RewardCalculationStatus;
  type: ProgressType;
  // if sequential, the last voting round with no gap after it
  // if not sequential, startVotingRoundId + number of processed rounds - 1
  progress?: number;
  confirmed?: boolean;
}

export interface ProgressConfig {
  fileName: string;
  sequentialCount: boolean;
}

/**
 * Returns the configuration for a given progress type.
 */
function progressConfig(progressType: ProgressType): ProgressConfig {
  switch (progressType) {
    case ProgressType.OFFER_DISTRIBUTION:
      return {
        fileName: OFFERS_FILE,
        sequentialCount: false,
      };
    case ProgressType.FEED_CALCULATION:
      return {
        fileName: FEED_VALUES_FILE,
        sequentialCount: false,
      };
    case ProgressType.CLAIM_CALCULATION:
      return {
        fileName: CLAIMS_FILE,
        sequentialCount: true,
      };
    case ProgressType.CLAIM_AGGREGATION:
      return {
        fileName: AGGREGATED_CLAIMS_FILE,
        sequentialCount: true,
      };
    default:
      // Ensure exhaustive checking
       
      ((_: never): void => {})(progressType);
  }
}

/**
 * Calculates the progress of reward calculation for a given reward epoch.
 */
export function rewardCalculationProgress(
  rewardEpochId: number,
  progressType: ProgressType,
  tempRewardEpochFolder = false,
  calculationFolder = CALCULATIONS_FOLDER()
): ProgressReport {
  const status = deserializeRewardEpochCalculationStatus(rewardEpochId, tempRewardEpochFolder, calculationFolder);
  const config = progressConfig(progressType);
  const tmpResult = {
    startVotingRoundId: status.startVotingRoundId,
    endVotingRoundId: status.endVotingRoundId,
    sequential: config.sequentialCount,
    status: status.calculationStatus,
    type: progressType,
  };
  if (status.calculationStatus === RewardCalculationStatus.PENDING) {
    return tmpResult;
  }
  if (status.calculationStatus === RewardCalculationStatus.DONE) {
    return {
      ...tmpResult,
      progress: status.endVotingRoundId,
      confirmed: true,
    };
  }
  const rewardEpochFolder = path.join(
    calculationFolder,
    `${tempRewardEpochFolder ? TEMP_REWARD_EPOCH_FOLDER_PREFIX : ""}${rewardEpochId}`
  );

  const numberExtractRegex = new RegExp(`^.*/(\\d+)/${config.fileName}$`);
  const result = globSync(
    `${tempRewardEpochFolder ? TEMP_REWARD_EPOCH_FOLDER_PREFIX : ""}${rewardEpochFolder}/**/${config.fileName}`
  )
    .map((file) => parseInt(file.replace(numberExtractRegex, "$1")))
    .filter((votingRoundId) => status.startVotingRoundId <= votingRoundId && votingRoundId <= status.endVotingRoundId);
  result.sort();

  if (result.length === 0) {
    return tmpResult;
  }

  if (!config.sequentialCount) {
    const newStatus = {
      ...tmpResult,
      progress: status.startVotingRoundId + result.length - 1,
    };
    if (result.length === status.endVotingRoundId - status.startVotingRoundId + 1) {
      newStatus.status = RewardCalculationStatus.DONE;
    }
    return newStatus;
  }
  // sequential count
  if (result[0] !== status.startVotingRoundId) {
    return tmpResult;
  }

  let progress = result[0];
  for (let i = 1; i < result.length; i++) {
    const votingRoundId = result[i];
    if (votingRoundId !== progress + 1) {
      // gap detected
      break;
    }
    progress = votingRoundId;
  }
  const newStatus = {
    ...tmpResult,
    progress,
  };
  if (result.length === status.endVotingRoundId - status.startVotingRoundId + 1) {
    newStatus.status = RewardCalculationStatus.DONE;
  }
  return newStatus;
}

/**
 * Provides a formatted progress for a given progress report.
 */
export function printProgress(progress: ProgressReport): string {
  let value = "-";
  if (progress.progress !== undefined) {
    value =
      ((progress.progress - progress.startVotingRoundId) / (progress.endVotingRoundId - progress.startVotingRoundId)) *
        100 +
      "%";
  }
  return `${progress.type} (${progress.status}): ${value}`;
}

/**
 * Records the progress of reward calculation for a given reward epoch into the progress files.
 */
export function recordProgress(
  rewardEpochId: number,
  tempRewardEpochFolder = false,
  calculationFolder = CALCULATIONS_FOLDER()
) {
  const progressOfferDistribution = rewardCalculationProgress(
    rewardEpochId,
    ProgressType.OFFER_DISTRIBUTION,
    tempRewardEpochFolder,
    calculationFolder
  );
  const progressFeedCalculation = rewardCalculationProgress(
    rewardEpochId,
    ProgressType.FEED_CALCULATION,
    tempRewardEpochFolder,
    calculationFolder
  );
  const progressClaimCalculation = rewardCalculationProgress(
    rewardEpochId,
    ProgressType.CLAIM_CALCULATION,
    tempRewardEpochFolder,
    calculationFolder
  );
  const progressClaimAggregation = rewardCalculationProgress(
    rewardEpochId,
    ProgressType.CLAIM_AGGREGATION,
    tempRewardEpochFolder,
    calculationFolder
  );
  const rewardEpochFolder = path.join(
    calculationFolder,
    `${tempRewardEpochFolder ? TEMP_REWARD_EPOCH_FOLDER_PREFIX : ""}${rewardEpochId}`
  );

  const statusFileProgressOfferDistribution = path.join(rewardEpochFolder, OFFER_DISTRIBUTION_PROGRESS_FILE);
  writeFileSync(statusFileProgressOfferDistribution, JSON.stringify(progressOfferDistribution));
  const statusFileProgressFeedCalculation = path.join(rewardEpochFolder, FEED_CALCULATION_PROGRESS_FILE);
  writeFileSync(statusFileProgressFeedCalculation, JSON.stringify(progressFeedCalculation));
  const statusFileProgressClaimCalculation = path.join(rewardEpochFolder, CLAIM_CALCULATION_PROGRESS_FILE);
  writeFileSync(statusFileProgressClaimCalculation, JSON.stringify(progressClaimCalculation));
  const statusFileProgressClaimAggregation = path.join(rewardEpochFolder, CLAIM_AGGREGATION_PROGRESS_FILE);
  writeFileSync(statusFileProgressClaimAggregation, JSON.stringify(progressClaimAggregation));
}
