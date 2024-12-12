import { Logger } from "@nestjs/common";
import * as workerPool from "workerpool";
import { DataManagerForRewarding } from "../../../../libs/ftso-core/src/DataManagerForRewarding";
import { BlockAssuranceResult } from "../../../../libs/ftso-core/src/IndexerClient";
import { IndexerClientForRewarding } from "../../../../libs/ftso-core/src/IndexerClientForRewarding";
import { FUInflationRewardsOffered } from "../../../../libs/ftso-core/src/events/FUInflationRewardsOffered";
import { IncentiveOffered } from "../../../../libs/ftso-core/src/events/IncentiveOffered";
import { initializeRewardEpochStorage } from "../../../../libs/ftso-core/src/reward-calculation/reward-calculation";
import { RewardEpochDuration } from "../../../../libs/ftso-core/src/utils/RewardEpochDuration";
import { recordProgress } from "../../../../libs/ftso-core/src/utils/stat-info/progress";
import {
  RewardCalculationStatus,
  setRewardCalculationStatus,
} from "../../../../libs/ftso-core/src/utils/stat-info/reward-calculation-status";
import {
  getRewardEpochInfo,
  serializeRewardEpochInfo,
} from "../../../../libs/ftso-core/src/utils/stat-info/reward-epoch-info";
import { destroyStorage } from "../../../../libs/ftso-core/src/utils/stat-info/storage";
import { OptionalCommandOptions } from "../interfaces/OptionalCommandOptions";
import { calculationOfRewardCalculationDataForRange } from "./calculator-utils";
import { RewardEpochManager } from "../../../../libs/ftso-core/src/RewardEpochManager";
import { FDCInflationRewardsOffered } from "../../../../libs/ftso-core/src/events/FDCInflationRewardsOffered";

export async function runCalculateRewardCalculationTopJob(
  indexerClient: IndexerClientForRewarding,
  rewardEpochManager: RewardEpochManager,
  options: OptionalCommandOptions
): Promise<RewardEpochDuration> {
  const logger = new Logger();
  const rewardEpochId = options.rewardEpochId;
  destroyStorage(rewardEpochId, options.tempRewardEpochFolder);
  // creates subfolders for voting rounds and distributes partial reward offers
  const [rewardEpochDuration, rewardEpoch] = await initializeRewardEpochStorage(
    rewardEpochId,
    rewardEpochManager,
    options.useExpectedEndIfNoSigningPolicyAfter,
    options.tempRewardEpochFolder
  );
  if (rewardEpochDuration.endVotingRoundId === undefined) {
    throw new Error(`Invalid reward epoch duration for reward epoch ${rewardEpochId}`);
  }

  let fuInflationRewardsOffered: FUInflationRewardsOffered | undefined;
  let fuIncentivesOfferedData: IncentiveOffered[] | undefined;
  let fdcInflationRewardsOffered: FDCInflationRewardsOffered | undefined;

  if (options.useFastUpdatesData) {
    const fuInflationRewardsOfferedResponse = await indexerClient.getFUInflationRewardsOfferedEvents(
      rewardEpoch.previousRewardEpochStartedEvent.startVotingRoundId,
      rewardEpoch.signingPolicy.startVotingRoundId - 1
    );
    if (fuInflationRewardsOfferedResponse.status !== BlockAssuranceResult.OK) {
      throw new Error(`Error while fetching FUInflationRewardsOffered events for reward epoch ${rewardEpochId}`);
    }
    fuInflationRewardsOffered = fuInflationRewardsOfferedResponse.data.find(x => x.rewardEpochId === rewardEpochId);
    if (fuInflationRewardsOffered === undefined) {
      throw new Error(`No FUInflationRewardsOffered event found for reward epoch ${rewardEpochId}`);
    }
    const fuIncentivesOfferedResponse = await indexerClient.getIncentiveOfferedEvents(
      rewardEpoch.signingPolicy.startVotingRoundId,
      rewardEpochDuration.endVotingRoundId
    );
    if (fuIncentivesOfferedResponse.status !== BlockAssuranceResult.OK) {
      throw new Error(`Error while fetching IncentiveOffered events for reward epoch ${rewardEpochId}`);
    }
    fuIncentivesOfferedData = fuIncentivesOfferedResponse.data;
  }
  if(options.useFDCData) {
    const fdcInflationRewardsOfferedResponse = await indexerClient.getFDCInflationRewardsOfferedEvents(
      rewardEpoch.previousRewardEpochStartedEvent.startVotingRoundId,
      rewardEpoch.signingPolicy.startVotingRoundId - 1
    );
    if (fdcInflationRewardsOfferedResponse.status !== BlockAssuranceResult.OK) {
      throw new Error(`Error while fetching FDCInflationRewardsOffered events for reward epoch ${rewardEpochId}`);
    }
    fdcInflationRewardsOffered = fdcInflationRewardsOfferedResponse.data.find(x => x.rewardEpochId === rewardEpochId);
    if (fdcInflationRewardsOffered === undefined) {
      throw new Error(`No FDCInflationRewardsOffered event found for reward epoch ${rewardEpochId}`);
    }
  }
  const rewardEpochInfo = getRewardEpochInfo(
    rewardEpoch,
    rewardEpochDuration.endVotingRoundId,
    fuInflationRewardsOffered,
    fuIncentivesOfferedData,
    fdcInflationRewardsOffered
  );
  serializeRewardEpochInfo(rewardEpochId, rewardEpochInfo, options.tempRewardEpochFolder);
  setRewardCalculationStatus(
    rewardEpochId,
    RewardCalculationStatus.PENDING,
    rewardEpoch,
    rewardEpochDuration.endVotingRoundId,
    options.tempRewardEpochFolder
  );
  setRewardCalculationStatus(
    rewardEpochId,
    RewardCalculationStatus.IN_PROGRESS,
    undefined,
    undefined,
    options.tempRewardEpochFolder
  );
  recordProgress(rewardEpochId, options.tempRewardEpochFolder);

  const start = options.startVotingRoundId ?? rewardEpochDuration.startVotingRoundId;
  const end = options.endVotingRoundId ?? rewardEpochDuration.endVotingRoundId;

  if (
    start === undefined ||
    start < rewardEpochDuration.startVotingRoundId ||
    start > rewardEpochDuration.endVotingRoundId
  ) {
    throw new Error(`Invalid start voting round id: ${start}`);
  }
  if (end === undefined || end < rewardEpochDuration.startVotingRoundId || end > rewardEpochDuration.endVotingRoundId) {
    throw new Error(`Invalid end voting round id: ${end}`);
  }
  logger.log("Using parallel processing for reward calculation data");
  logger.log(options);
  logger.log("-------------------");
  const pool = workerPool.pool(__dirname + "/../workers/calculation-data-worker.js", {
    maxWorkers: options.numberOfWorkers,
    workerType: "thread",
  });
  const promises = [];
  for (
    let votingRoundId = rewardEpochDuration.startVotingRoundId;
    votingRoundId <= end;
    votingRoundId += options.batchSize
  ) {
    const endBatch = Math.min(votingRoundId + options.batchSize - 1, end);
    const batchOptions: OptionalCommandOptions = {
      rewardEpochId: rewardEpochDuration.rewardEpochId,
      calculateRewardCalculationData: true,
      startVotingRoundId: votingRoundId,
      endVotingRoundId: endBatch,
      isWorker: true,
      useFastUpdatesData: options.useFastUpdatesData,
      useFDCData: options.useFDCData,
      tempRewardEpochFolder: options.tempRewardEpochFolder,
    };
    // logger.log(batchOptions);
    promises.push(pool.exec("run", [batchOptions]));
  }
  await Promise.all(promises);
  await pool.terminate();
  logger.log(`Batch calculation for reward calculation data done: ${rewardEpochDuration.startVotingRoundId} - ${end}`);
  return rewardEpochDuration;
}

export async function runCalculateRewardCalculationDataWorker(
  dataManager: DataManagerForRewarding,
  options: OptionalCommandOptions
): Promise<void> {
  const startTime = Date.now();
  const logger = new Logger();
  const rewardEpochId = options.rewardEpochId;

  await calculationOfRewardCalculationDataForRange(
    dataManager,
    options.rewardEpochId,
    options.startVotingRoundId,
    options.endVotingRoundId,
    options.retryDelayMs,
    logger,
    options.useFastUpdatesData,
    options.useFDCData,
    options.tempRewardEpochFolder
  );
  logger.log(
    `Reward calculation data calculated for ${options.startVotingRoundId}-${options.endVotingRoundId} took ${
      Date.now() - startTime
    } ms.`
  );
  recordProgress(rewardEpochId, options.tempRewardEpochFolder);
}
