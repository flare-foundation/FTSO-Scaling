import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import FakeTimers from "@sinonjs/fake-timers";
import { existsSync, mkdirSync } from "fs";
import path from "path/posix";
import { EntityManager } from "typeorm";
import * as workerPool from "workerpool";
import { DataManager } from "../../../../libs/ftso-core/src/DataManager";
import { IndexerClient } from "../../../../libs/ftso-core/src/IndexerClient";
import { RewardEpochManager } from "../../../../libs/ftso-core/src/RewardEpochManager";
import {
  BURN_ADDRESS,
  CONTRACTS,
  EPOCH_SETTINGS,
  RANDOM_GENERATION_BENCHING_WINDOW,
} from "../../../../libs/ftso-core/src/configs/networks";
import { RewardEpochStarted } from "../../../../libs/ftso-core/src/events";
import {
  aggregateRewardClaimsInStorage,
  initializeRewardEpochStorage,
  partialRewardClaimsForVotingRound,
  prepareDataForRewardCalculations,
} from "../../../../libs/ftso-core/src/reward-calculation/reward-calculation";
import { granulatedPartialOfferMapForRandomFeedSelection } from "../../../../libs/ftso-core/src/reward-calculation/reward-offers";
import { IPartialRewardOfferForRound } from "../../../../libs/ftso-core/src/utils/PartialRewardOffer";
import { RewardClaim } from "../../../../libs/ftso-core/src/utils/RewardClaim";
import { RewardEpochDuration } from "../../../../libs/ftso-core/src/utils/RewardEpochDuration";
import { sleepFor } from "../../../../libs/ftso-core/src/utils/retry";
import { deserializeAggregatedClaimsForVotingRoundId } from "../../../../libs/ftso-core/src/utils/stat-info/aggregated-claims";
import { serializeFinalRewardClaims } from "../../../../libs/ftso-core/src/utils/stat-info/final-reward-claims";
import { serializeGranulatedPartialOfferMap } from "../../../../libs/ftso-core/src/utils/stat-info/granulated-partial-offers-map";
import { getAggregationProgress, recordProgress } from "../../../../libs/ftso-core/src/utils/stat-info/progress";
import {
  deserializeDataForRewardCalculation,
  writeDataForRewardCalculation,
} from "../../../../libs/ftso-core/src/utils/stat-info/reward-calculation-data";
import {
  RewardCalculationStatus,
  deserializeRewardEpochCalculationStatus,
  rewardEpochCalculationStatusExists,
  setRewardCalculationStatus,
} from "../../../../libs/ftso-core/src/utils/stat-info/reward-calculation-status";
import { serializeRewardDistributionData } from "../../../../libs/ftso-core/src/utils/stat-info/reward-distribution-data";
import {
  getRewardEpochInfo,
  serializeRewardEpochInfo,
} from "../../../../libs/ftso-core/src/utils/stat-info/reward-epoch-info";
import { destroyStorage } from "../../../../libs/ftso-core/src/utils/stat-info/storage";

export interface OptionalCommandOptions {
  rewardEpochId?: number;
  startRewardEpochId?: number;
  endRewardEpochId?: number;
  useExpectedEndIfNoSigningPolicyAfter?: boolean;
  startVotingRoundId?: number;
  endVotingRoundId?: number;
  initialize?: boolean;
  calculateRewardCalculationData?: boolean;
  calculateOffers?: boolean;
  calculateClaims?: boolean;
  aggregateClaims?: boolean;
  retryDelayMs?: number;
  // if set, then parallel processing is enabled
  batchSize?: number;
  numberOfWorkers?: number;
  // if set, the logs will be written to the file
  loggerFile?: string;
  calculationFolder?: string;
  isWorker?: boolean;
  recoveryMode?: boolean;
}

if (process.env.FORCE_NOW) {
  const newNow = parseInt(process.env.FORCE_NOW) * 1000;
  FakeTimers.install({ now: newNow });
}

@Injectable()
export class CalculatorService {
  private readonly logger = new Logger(CalculatorService.name);
  // private readonly epochSettings: EpochSettings;
  private readonly indexerClient: IndexerClient;
  private rewardEpochManager: RewardEpochManager;
  private dataManager: DataManager;
  private entityManager: EntityManager;

  // Indexer top timeout margin
  private indexer_top_timeout: number;

  constructor(manager: EntityManager, configService: ConfigService) {
    this.entityManager = manager;
    const required_history_sec = configService.get<number>("required_indexer_history_time_sec");
    this.indexer_top_timeout = configService.get<number>("indexer_top_timeout");
    this.indexerClient = new IndexerClient(manager, required_history_sec, this.logger);
    this.rewardEpochManager = new RewardEpochManager(this.indexerClient);
    this.dataManager = new DataManager(this.indexerClient, this.rewardEpochManager, this.logger);
  }

  setupEnvVariables(config: any) {
    process.env.NETWORK = "from-env";
    // eslint-disable-next-line guard-for-in
    for (const key in config) {
      if (typeof config[key] !== "string" && typeof config[key] !== "number" && typeof config[key] !== "bigint") {
        throw new Error(`Invalid type for ${key}, expected string, number or bigint, got ${typeof config[key]}`);
      }
      process.env[key] = config[key].toString();
    }
  }

  /**
   * Checks into the indexer for the latest reward epoch start event and returns the reward epoch id.
   * It looks into the history of depth of 5 reward epoch lengths from now.
   */
  async latestRewardEpochStart(HISTORY_DEPTH_IN_REWARD_EPOCHS = 5): Promise<number | undefined> {
    const eventName = RewardEpochStarted.eventName;
    const historyDepth =
      EPOCH_SETTINGS().rewardEpochDurationInVotingEpochs *
      HISTORY_DEPTH_IN_REWARD_EPOCHS *
      EPOCH_SETTINGS().votingEpochDurationSeconds;
    const startTime = Math.floor(Date.now() / 1000) - historyDepth;
    const result = await this.indexerClient.queryEvents(CONTRACTS.FlareSystemsManager, eventName, startTime);
    const events = result.map(event => RewardEpochStarted.fromRawEvent(event));
    if (events.length > 0) {
      return events[events.length - 1].rewardEpochId;
    }
    return;
  }

  claimAggregation(rewardEpochDuration: RewardEpochDuration, votingRoundId: number, logger: Logger) {
    logger.log(`Aggregating claims for voting round: ${votingRoundId}`);
    if (votingRoundId === rewardEpochDuration.startVotingRoundId) {
      aggregateRewardClaimsInStorage(rewardEpochDuration.rewardEpochId, votingRoundId, votingRoundId, true);
    } else {
      aggregateRewardClaimsInStorage(rewardEpochDuration.rewardEpochId, votingRoundId - 1, votingRoundId, false);
    }
  }

  async calculationOfRewardCalculationData(
    rewardEpochDuration: RewardEpochDuration,
    votingRoundId: number,
    retryDelayMs: number,
    logger: Logger
  ) {
    let done = false;
    while (!done) {
      try {
        logger.log(`Calculating data for reward calculation for voting round: ${votingRoundId}`);
        await prepareDataForRewardCalculations(
          rewardEpochDuration.rewardEpochId,
          votingRoundId,
          RANDOM_GENERATION_BENCHING_WINDOW(),
          this.dataManager
        );
        done = true;
      } catch (e) {
        logger.error(
          `Error while calculating reward calculation data for voting round ${votingRoundId} in reward epoch ${rewardEpochDuration.rewardEpochId}: ${e}`
        );
        // TODO: calculate expected time when data should be ready. If not, keep delaying for 10s
        const delay = retryDelayMs ?? 10000;
        logger.log(`Sleeping for ${delay / 1000}s before retrying...`);
        await sleepFor(delay);
      }
    }
  }

  async calculateClaimsAndAggregate(
    rewardEpochDuration: RewardEpochDuration,
    votingRoundId: number,
    aggregateClaims: boolean,
    retryDelayMs: number,
    logger: Logger
  ) {
    let done = false;
    while (!done) {
      try {
        logger.log(`Calculating claims for voting round: ${votingRoundId}`);
        await partialRewardClaimsForVotingRound(
          rewardEpochDuration.rewardEpochId,
          votingRoundId,
          RANDOM_GENERATION_BENCHING_WINDOW(),
          this.dataManager,
          undefined, // should be read from calculations folder
          false, // reward calculation data should be already calculated
          false, // don't merge
          true, // add logs
          true //serializeResults
        );
        if (aggregateClaims) {
          this.claimAggregation(rewardEpochDuration, votingRoundId, logger);
        }
        done = true;
      } catch (e) {
        logger.error(
          `Error while calculating reward claims for voting round ${votingRoundId} in reward epoch ${rewardEpochDuration.rewardEpochId}: ${e}`
        );
        // TODO: calculate expected time when data should be ready. If not, keep delaying for 10s
        const delay = retryDelayMs ?? 10000;
        logger.log(`Sleeping for ${delay / 1000}s before retrying...`);
        await sleepFor(delay);
      }
    }
  }

  async batchCalculateRewardCalculationData(
    options: OptionalCommandOptions,
    rewardEpochDuration: RewardEpochDuration,
    end: number,
    useExpectedEndIfNoSigningPolicyAfter: boolean,
    logger: Logger
  ) {
    logger.log("Using parallel processing for reward calculation data");
    logger.log(options);
    logger.log("-------------------");
    const pool = workerPool.pool(__dirname + "/../claim-calculation-worker.js", {
      maxWorkers: options.numberOfWorkers,
    });
    const promises = [];
    for (
      let votingRoundId = rewardEpochDuration.startVotingRoundId;
      votingRoundId <= end;
      votingRoundId += options.batchSize
    ) {
      const endBatch = Math.min(votingRoundId + options.batchSize - 1, end);
      let loggerFile;
      if (options.calculationFolder !== undefined) {
        const logFolder = path.join(options.calculationFolder, `logs`);
        if (!existsSync(logFolder)) {
          mkdirSync(logFolder);
        }
        loggerFile = path.join(logFolder, `logs-${votingRoundId}-${endBatch}.log`);
      }
      const batchOptions: OptionalCommandOptions = {
        rewardEpochId: rewardEpochDuration.rewardEpochId,
        calculateRewardCalculationData: true,
        startVotingRoundId: votingRoundId,
        endVotingRoundId: endBatch,
        loggerFile,
        isWorker: true,
        useExpectedEndIfNoSigningPolicyAfter,
      };
      // logger.log(batchOptions);
      promises.push(pool.exec("run", [batchOptions]));
    }
    await Promise.all(promises);
    await pool.terminate();
    logger.log("Batch calculation for reward calculation data done", end);
  }

  async batchCalculateClaimsAndAggregations(
    options: OptionalCommandOptions,
    rewardEpochDuration: RewardEpochDuration,
    end: number,
    aggregateClaims: boolean,
    useExpectedEndIfNoSigningPolicyAfter: boolean,
    logger: Logger
  ) {
    logger.log("Using parallel processing");
    logger.log(options);
    logger.log("-------------------");
    const pool = workerPool.pool(__dirname + "/../claim-calculation-worker.js", {
      maxWorkers: options.numberOfWorkers,
    });
    const promises = [];
    for (
      let votingRoundId = rewardEpochDuration.startVotingRoundId;
      votingRoundId <= end;
      votingRoundId += options.batchSize
    ) {
      const endBatch = Math.min(votingRoundId + options.batchSize - 1, end);
      let loggerFile;
      if (options.calculationFolder !== undefined) {
        const logFolder = path.join(options.calculationFolder, `logs`);
        if (!existsSync(logFolder)) {
          mkdirSync(logFolder);
        }
        loggerFile = path.join(logFolder, `logs-${votingRoundId}-${endBatch}.log`);
      }
      const batchOptions = {
        rewardEpochId: rewardEpochDuration.rewardEpochId,
        calculateClaims: true,
        startVotingRoundId: votingRoundId,
        endVotingRoundId: endBatch,
        loggerFile,
        isWorker: true,
        useExpectedEndIfNoSigningPolicyAfter,
      };
      // logger.log(batchOptions);
      promises.push(pool.exec("run", [batchOptions]));
    }
    await Promise.all(promises);
    await pool.terminate();
    logger.log("Batch done", aggregateClaims, end);
    if (aggregateClaims) {
      for (let votingRoundId = rewardEpochDuration.startVotingRoundId; votingRoundId <= end; votingRoundId++) {
        this.claimAggregation(rewardEpochDuration, votingRoundId, logger);
      }
    }
  }

  /**
   * Returns a list of all (merged) reward claims for the given reward epoch.
   * Calculation can be quite intensive.
   */
  async run(options: OptionalCommandOptions): Promise<void> {
    const logger = new Logger();
    logger.log(options);
    let startRewardEpochId;
    let endRewardEpochId;
    // Determine which reward epoch should be calculated
    if (options.startRewardEpochId !== undefined && options.rewardEpochId === undefined) {
      startRewardEpochId = options.startRewardEpochId;
      // may be undefined. This means that we are calculating current reward epoch incrementally
      endRewardEpochId = options.endRewardEpochId;
    } else if (options.startRewardEpochId === undefined && options.rewardEpochId !== undefined) {
      // only one specific reward epoch
      startRewardEpochId = options.rewardEpochId;
      endRewardEpochId = options.rewardEpochId;
    } else if (options.startRewardEpochId === undefined && options.rewardEpochId === undefined) {
      const latestRewardEpochId = await this.latestRewardEpochStart();
      if (latestRewardEpochId === undefined) {
        throw new Error("Critical error: No latest reward epoch found.");
      }
      // We start with the latest reward epoch we know it is finished
      startRewardEpochId = latestRewardEpochId - 1;
      endRewardEpochId = latestRewardEpochId - 1;
    } else {
      throw new Error(
        `Invalid parameter options. Either rewardEpochId should be provided or a pair of startRewardEpochId and rpc should be provided, or none`
      );
    }
    let rewardEpochId = startRewardEpochId;

    // Each round of the loop is one reward epoch calculation
    // If calculation range is limited, then the loop breaks.
    // If not, the loop enters incremental calculation waiting for new voting rounds to be finalized.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // end reward epoch was set
      if (endRewardEpochId && rewardEpochId > endRewardEpochId) {
        // all done, finish
        logger.log("ALL DONE", rewardEpochId, startRewardEpochId, endRewardEpochId);
        return;
      }
      // Recovery data in case of incremental calculation
      let skipInitializationForRecovery = false;
      let recoveryStartVotingRoundId: number | undefined = undefined;
      // Check for existing calculated reward epochs
      if (rewardEpochCalculationStatusExists(rewardEpochId)) {
        const status = deserializeRewardEpochCalculationStatus(rewardEpochId);
        if (status.calculationStatus === RewardCalculationStatus.DONE) {
          logger.log("Skipping reward epoch", rewardEpochId, "as it is already done");
          rewardEpochId++;
          continue;
        }
        // recovery mode works only for incremental calculation
        // TODO: revisit
        if (options.recoveryMode && options.batchSize === undefined) {
          const aggregationProgress = getAggregationProgress(rewardEpochId);
          if (
            aggregationProgress &&
            aggregationProgress.status === RewardCalculationStatus.IN_PROGRESS &&
            aggregationProgress.progress !== undefined
          ) {
            skipInitializationForRecovery = true;
            recoveryStartVotingRoundId = aggregationProgress.progress;
          }
          logger.log(
            `Recovery mode: reward epoch ${rewardEpochId}, starting from voting round ${recoveryStartVotingRoundId}`
          );
        }
      }
      const latestRewardEpochId = await this.latestRewardEpochStart();
      const isIncrementalMode = !options.isWorker && rewardEpochId === latestRewardEpochId;
      if (isIncrementalMode) {
        logger.log("Incremental mode");
      }
      let rewardEpochDuration;
      let rewardEpoch;
      if (options.initialize && !skipInitializationForRecovery) {
        logger.log(`Initializing reward epoch storage for reward epoch ${rewardEpochId}`);
        destroyStorage(rewardEpochId);
        // creates subfolders for voting rounds and distributes partial reward offers
        [rewardEpochDuration, rewardEpoch] = await initializeRewardEpochStorage(
          rewardEpochId,
          this.rewardEpochManager,
          isIncrementalMode ? true : options.useExpectedEndIfNoSigningPolicyAfter
        );
      } else {
        rewardEpochDuration = await this.rewardEpochManager.getRewardEpochDurationRange(
          rewardEpochId,
          isIncrementalMode ? true : options.useExpectedEndIfNoSigningPolicyAfter
        );
        rewardEpoch = await this.rewardEpochManager.getRewardEpochForVotingEpochId(
          rewardEpochDuration.startVotingRoundId
        );
      }

      // Serialization of reward epoch info, statuses and recording intial progress
      if (options.initialize && !skipInitializationForRecovery) {
        const rewardEpochInfo = getRewardEpochInfo(
          rewardEpoch,
          isIncrementalMode ? undefined : rewardEpochDuration.endVotingRoundId
        );
        serializeRewardEpochInfo(rewardEpochId, rewardEpochInfo);
        setRewardCalculationStatus(
          rewardEpochId,
          RewardCalculationStatus.PENDING,
          rewardEpoch,
          rewardEpochDuration.endVotingRoundId
        );
        setRewardCalculationStatus(rewardEpochId, RewardCalculationStatus.IN_PROGRESS);
        recordProgress(rewardEpochId);
      }

      const start = recoveryStartVotingRoundId ?? options.startVotingRoundId ?? rewardEpochDuration.startVotingRoundId;
      const end = options.endVotingRoundId ?? rewardEpochDuration.endVotingRoundId;
      if (start < rewardEpochDuration.startVotingRoundId || start > rewardEpochDuration.endVotingRoundId) {
        throw new Error(`Invalid start voting round id: ${start}`);
      }
      if (end < rewardEpochDuration.startVotingRoundId || end > rewardEpochDuration.endVotingRoundId) {
        throw new Error(`Invalid end voting round id: ${end}`);
      }
      let lastBatchCalculationVotingRoundId: number = end;
      let forceSkipBatchCalculation = false;

      if (isIncrementalMode) {
        const calculatedCurrentVotingRoundId = EPOCH_SETTINGS().votingEpochForTime(Date.now());
        const estimatedFinalizedVotingRoundId = calculatedCurrentVotingRoundId - 5;
        if (estimatedFinalizedVotingRoundId < rewardEpochDuration.startVotingRoundId + (options.batchSize ?? 0)) {
          forceSkipBatchCalculation = true;
        } else {
          lastBatchCalculationVotingRoundId = estimatedFinalizedVotingRoundId;
        }
      }

      if (options.calculateRewardCalculationData) {
        // first try to do batch calculations
        if (options.batchSize !== undefined && options.batchSize > 0 && !forceSkipBatchCalculation) {
          await this.batchCalculateRewardCalculationData(
            options,
            rewardEpochDuration,
            lastBatchCalculationVotingRoundId,
            isIncrementalMode,
            logger
          );
          recordProgress(rewardEpochId);
        }
        // then proceed to incremental, if needed
        if (isIncrementalMode || options.batchSize === undefined) {
          let serialStart = start;
          const serialEnd = end;

          if (isIncrementalMode) {
            serialStart = Math.max(lastBatchCalculationVotingRoundId, start);
          }
          for (let votingRoundId = serialStart; votingRoundId <= serialEnd; votingRoundId++) {
            await this.calculationOfRewardCalculationData(
              rewardEpochDuration,
              votingRoundId,
              options.retryDelayMs,
              logger
            );
            recordProgress(rewardEpochId);
          }
        }
        if (!isIncrementalMode && !options.isWorker) {
          for (let votingRoundId = start; votingRoundId <= end; votingRoundId++) {
            if (votingRoundId > rewardEpochDuration.startVotingRoundId) {
              const previousCalculationData = deserializeDataForRewardCalculation(rewardEpochId, votingRoundId - 1);
              if (!previousCalculationData) {
                throw new Error(`Missing reward calculation data for previous voting round ${votingRoundId - 1}`);
              }
              const currentCalculationData = deserializeDataForRewardCalculation(rewardEpochId, votingRoundId);
              if (!currentCalculationData) {
                throw new Error(`Missing reward calculation data for voting round ${votingRoundId}`);
              }
              previousCalculationData.nextVotingRoundRandomResult = currentCalculationData.randomResult;
              writeDataForRewardCalculation(previousCalculationData);
              logger.log(`Fixing random for voting round ${votingRoundId - 1}`);

              if (votingRoundId === rewardEpochDuration.endVotingRoundId) {
                currentCalculationData.nextVotingRoundRandomResult = currentCalculationData.randomResult;
                writeDataForRewardCalculation(currentCalculationData);
                logger.log(`Fixing random for voting round ${votingRoundId}`);
              }
            }
          }
        }
      }

      if (options.calculateOffers) {
        const randomNumbers: bigint[] = [];
        for (let votingRoundId = start; votingRoundId <= end; votingRoundId++) {
          const data = deserializeDataForRewardCalculation(rewardEpochId, votingRoundId);
          if (!data) {
            throw new Error(`Missing reward calculation data for voting round ${votingRoundId}`);
          }
          randomNumbers.push(data.randomResult.random);
        }

        const rewardOfferMap: Map<
          number,
          Map<string, IPartialRewardOfferForRound[]>
        > = granulatedPartialOfferMapForRandomFeedSelection(
          rewardEpochDuration.startVotingRoundId,
          rewardEpochDuration.endVotingRoundId,
          rewardEpoch,
          randomNumbers
        );
        // sync call
        serializeGranulatedPartialOfferMap(rewardEpochDuration, rewardOfferMap, false);
      }

      if (options.calculateClaims) {
        // first try to do batch calculations
        if (options.batchSize !== undefined && options.batchSize > 0 && !forceSkipBatchCalculation) {
          await this.batchCalculateClaimsAndAggregations(
            options,
            rewardEpochDuration,
            lastBatchCalculationVotingRoundId,
            isIncrementalMode,
            isIncrementalMode,
            logger
          );
          recordProgress(rewardEpochId);
        }
        // then proceed to incremental, if needed
        if (isIncrementalMode || options.batchSize === undefined) {
          let serialStart = start;
          const serialEnd = end;

          if (isIncrementalMode) {
            serialStart = Math.max(lastBatchCalculationVotingRoundId, start);
          }
          for (let votingRoundId = serialStart; votingRoundId <= serialEnd; votingRoundId++) {
            await this.calculateClaimsAndAggregate(
              rewardEpochDuration,
              votingRoundId,
              options.aggregateClaims && isIncrementalMode,
              options.retryDelayMs,
              logger
            );
            recordProgress(rewardEpochId);
          }
        }
      }

      if (!isIncrementalMode && options.aggregateClaims) {
        for (let votingRoundId = start; votingRoundId <= end; votingRoundId++) {
          this.claimAggregation(rewardEpochDuration, votingRoundId, logger);
        }
      }

      if (
        end === rewardEpochDuration.endVotingRoundId &&
        (options.aggregateClaims || options.calculateClaims || options.calculateRewardCalculationData)
      ) {
        if (options.aggregateClaims) {
          setRewardCalculationStatus(rewardEpochId, RewardCalculationStatus.DONE);
          recordProgress(rewardEpochId);
          const lastClaims = deserializeAggregatedClaimsForVotingRoundId(rewardEpochId, end);
          serializeFinalRewardClaims(rewardEpochId, lastClaims);
          const finalClaimsWithBurnsApplied = RewardClaim.mergeWithBurnClaims(lastClaims, BURN_ADDRESS);
          serializeRewardDistributionData(rewardEpochId, finalClaimsWithBurnsApplied);
        }
        rewardEpochId++;
        logger.log(`Incrementing reward epoch id to ${rewardEpochId}`);
        continue;
      }
      recordProgress(rewardEpochId);
      // Do not go through loop more then once if this is worker
      if (options.isWorker) {
        return;
      }
    } // end of while loop
  }
}
