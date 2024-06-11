import { Logger } from "@nestjs/common";
import * as workerPool from "workerpool";
import { RewardEpochDuration } from "../../../../libs/ftso-core/src/utils/RewardEpochDuration";
import { recordProgress } from "../../../../libs/ftso-core/src/utils/stat-info/progress";
import { deserializeRewardEpochInfo } from "../../../../libs/ftso-core/src/utils/stat-info/reward-epoch-info";
import { OptionalCommandOptions } from "../interfaces/OptionalCommandOptions";
import { calculateClaimsAndAggregate } from "./claim-utils";
import { DataManagerForRewarding } from "../../../../libs/ftso-core/src/DataManagerForRewarding";

export async function runCalculateRewardClaimsTopJob(options: OptionalCommandOptions): Promise<RewardEpochDuration> {
  const logger = new Logger();
  const rewardEpochId = options.rewardEpochId;
  const rewardEpochInfo = deserializeRewardEpochInfo(rewardEpochId);
  const startVotingRoundId = rewardEpochInfo.signingPolicy.startVotingRoundId;
  const endVotingRoundId = rewardEpochInfo.endVotingRoundId;
  const rewardEpochDuration: RewardEpochDuration = {
    rewardEpochId,
    startVotingRoundId,
    endVotingRoundId,
    expectedEndUsed: false,
  };

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
  logger.log("Using parallel processing for reward claims");
  logger.log(options);
  logger.log("-------------------");
  const pool = workerPool.pool(__dirname + "/../workers/claim-only-calculation-worker.js", {
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
    const batchOptions = {
      rewardEpochId: rewardEpochDuration.rewardEpochId,
      calculateClaims: true,
      startVotingRoundId: votingRoundId,
      endVotingRoundId: endBatch,
      isWorker: true,
      useFastUpdatesData: options.useFastUpdatesData,
    };

    // logger.log(batchOptions);
    promises.push(pool.exec("run", [batchOptions]));
  }
  await Promise.all(promises);
  await pool.terminate();
  logger.log(`Batch calculation for reward claims done (${rewardEpochDuration.startVotingRoundId}-${end})`);
  return rewardEpochDuration;
}

export async function runCalculateRewardClaimWorker(
  dataManager: DataManagerForRewarding,
  options: OptionalCommandOptions
): Promise<void> {
  const startTime = Date.now();
  const logger = new Logger();
  const rewardEpochId = options.rewardEpochId;
  const rewardEpochInfo = deserializeRewardEpochInfo(rewardEpochId);
  const startVotingRoundId = rewardEpochInfo.signingPolicy.startVotingRoundId;
  const endVotingRoundId = rewardEpochInfo.endVotingRoundId;
  const rewardEpochDuration: RewardEpochDuration = {
    rewardEpochId,
    startVotingRoundId,
    endVotingRoundId,
    expectedEndUsed: false,
  };

  for (let votingRoundId = options.startVotingRoundId; votingRoundId <= options.endVotingRoundId; votingRoundId++) {
    await calculateClaimsAndAggregate(
      dataManager,
      rewardEpochDuration,
      votingRoundId,
      false, // don't aggregate
      options.retryDelayMs,
      logger,
      options.useFastUpdatesData
    );
    recordProgress(rewardEpochId);
  }
  logger.log(
    `Claim calculation done for voting rounds ${startVotingRoundId}-${endVotingRoundId} in ${
      Date.now() - startTime
    } ms.`
  );
}
