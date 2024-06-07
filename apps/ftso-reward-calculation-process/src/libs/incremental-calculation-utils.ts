import { Logger } from "@nestjs/common";
import * as workerPool from "workerpool";
import { RewardEpochManager } from "../../../../libs/ftso-core/src/RewardEpochManager";
import { EPOCH_SETTINGS, FUTURE_VOTING_ROUNDS } from "../../../../libs/ftso-core/src/configs/networks";
import { fixOffersForRandomFeedSelection } from "../../../../libs/ftso-core/src/reward-calculation/reward-offers";
import { RewardEpochDuration } from "../../../../libs/ftso-core/src/utils/RewardEpochDuration";
import {
  cleanupVotingRoundFolder,
  createVotingRoundFolder,
} from "../../../../libs/ftso-core/src/utils/stat-info/storage";
import { IncrementalCalculationState } from "../interfaces/IncrementalCalculationState";
import { OptionalCommandOptions } from "../interfaces/OptionalCommandOptions";
import { initializeTemplateOffers } from "./offer-utils";
import { extractRandomNumbers } from "./random-number-fixing-utils";

// incremental

export function incrementalExtendRewardEpochDuration(state: IncrementalCalculationState) {
  const ADDITIONAL_ROUNDS = 10;
  // add some additional rounds
  const newEndVotingRoundId = state.votingRoundId + ADDITIONAL_ROUNDS;
  for (
    let tmpVotingRoundId = state.finalProcessedVotingRoundId + 1;
    tmpVotingRoundId <= newEndVotingRoundId;
    tmpVotingRoundId++
  ) {
    createVotingRoundFolder(state.rewardEpochId, tmpVotingRoundId);
  }
  state.maxVotingRoundIdFolder = newEndVotingRoundId;
  state.endVotingRoundId = newEndVotingRoundId;
  // reinitialize offers
  initializeTemplateOffers(state.rewardEpochInfo, state.endVotingRoundId);
  const randomNumbers = extractRandomNumbers(
    state.rewardEpochId,
    state.startVotingRoundId,
    state.nextVotingRoundIdWithNoSecureRandom - 1
  );
  fixOffersForRandomFeedSelection(
    state.rewardEpochId,
    state.startVotingRoundId,
    state.nextVotingRoundIdWithNoSecureRandom - 1,
    state.rewardEpochInfo,
    randomNumbers
  );
  state.finalProcessedVotingRoundId = newEndVotingRoundId + FUTURE_VOTING_ROUNDS();
}

export async function cleanupAndReturnFinalEpochDuration(
  rewardEpochManager: RewardEpochManager,
  state: IncrementalCalculationState
): Promise<RewardEpochDuration> {
  const finalRewardEpochDuration = await rewardEpochManager.getRewardEpochDurationRange(state.rewardEpochId);
  for (
    let votingRoundId = finalRewardEpochDuration.endVotingRoundId + 1;
    votingRoundId <= state.maxVotingRoundIdFolder;
    votingRoundId++
  ) {
    cleanupVotingRoundFolder(state.rewardEpochId, votingRoundId);
  }
  // sanity check
  if (state.endVotingRoundId !== finalRewardEpochDuration.endVotingRoundId) {
    throw new Error(
      `Mismatch in endVotingRoundId: ${state.endVotingRoundId} vs ${finalRewardEpochDuration.endVotingRoundId}`
    );
  }
  return finalRewardEpochDuration;
}

export async function incrementalBatchCatchup(
  rewardEpochDuration: RewardEpochDuration,
  options: OptionalCommandOptions,
  logger: Logger
): Promise<number> {
  const calculatedCurrentVotingRoundId = EPOCH_SETTINGS().votingEpochForTime(Date.now());
  const end = calculatedCurrentVotingRoundId - 5;
  logger.log("Using parallel processing for reward calculation data catchup");
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
    };
    // logger.log(batchOptions);
    promises.push(pool.exec("run", [batchOptions]));
  }
  await Promise.all(promises);
  await pool.terminate();
  logger.log(`Batch calculation for reward calculation data done: ${rewardEpochDuration.startVotingRoundId} - ${end}`);
  return end;
}
