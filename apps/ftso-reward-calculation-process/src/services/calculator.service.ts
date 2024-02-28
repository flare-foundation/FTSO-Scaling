import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import FakeTimers from "@sinonjs/fake-timers";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path/posix";
import { EntityManager } from "typeorm";
import * as workerPool from "workerpool";
import { DataManager } from "../../../../libs/ftso-core/src/DataManager";
import { IndexerClient } from "../../../../libs/ftso-core/src/IndexerClient";
import { RewardEpochManager } from "../../../../libs/ftso-core/src/RewardEpochManager";
import { RANDOM_GENERATION_BENCHING_WINDOW } from "../../../../libs/ftso-core/src/configs/networks";
import {
  aggregateRewardClaimsInStorage,
  initializeRewardEpochStorage,
  partialRewardClaimsForVotingRound,
} from "../../../../libs/ftso-core/src/reward-calculation/reward-calculation";
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

export interface OptionalCommandOptions {
  rewardEpochId?: number;
  useExpectedEndIfNoSigningPolicyAfter?: boolean;
  startVotingRoundId?: number;
  endVotingRoundId?: number;
  initialize?: boolean;
  calculateClaims?: boolean;
  aggregateClaims?: boolean;
  retryDelay?: number;
  // if set, then parallel processing is enabled
  batchSize?: number;
  numberOfWorkers?: number;
  // if set, the logs will be written to the file
  loggerFile?: string;
  calculationFolder?: string;
  isWorker?: boolean;
}

if (process.env.FORCE_NOW) {
  const newNow = parseInt(process.env.FORCE_NOW) * 1000;
  FakeTimers.install({ now: newNow });
}

export class SimpleFileLogger {
  private file: string;

  constructor(file: string) {
    this.file = file;
    writeFileSync(this.file, "");
  }
  log(message: any) {
    const processedMessage = JSON.stringify(message, null, 2);
    appendFileSync(this.file, processedMessage + "\n");
  }
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
    this.indexerClient = new IndexerClient(manager, required_history_sec);
    this.rewardEpochManager = new RewardEpochManager(this.indexerClient);
    this.dataManager = new DataManager(this.indexerClient, this.rewardEpochManager, this.logger);
  }

  setupEnvVariables(config: any) {
    process.env.NETWORK = "from-env";
    for (const key in config) {
      if (typeof config[key] !== "string" && typeof config[key] !== "number" && typeof config[key] !== "bigint") {
        throw new Error(`Invalid type for ${key}, expected string, number or bigint, got ${typeof config[key]}`);
      }
      process.env[key] = config[key].toString();
    }
  }

  /**
   * Returns a list of all (merged) reward claims for the given reward epoch.
   * Calculation can be quite intensive.
   * @param rewardEpochId
   * @returns
   */
  async run(options: OptionalCommandOptions): Promise<void> {
    const logger = options.loggerFile ? new SimpleFileLogger(options.loggerFile) : console;
    logger.log(options);
    if (options.rewardEpochId === undefined) {
      throw new Error("Reward epoch id is required");
    }

    let rewardEpochDuration;
    if (options.initialize) {
      logger.log("Initializing reward epoch storage");
      destroyStorage(options.rewardEpochId);
      rewardEpochDuration = await initializeRewardEpochStorage(
        options.rewardEpochId,
        this.rewardEpochManager,
        options.useExpectedEndIfNoSigningPolicyAfter
      );
    } else {
      rewardEpochDuration = await this.rewardEpochManager.getRewardEpochDurationRange(
        options.rewardEpochId,
        options.useExpectedEndIfNoSigningPolicyAfter
      );
    }

    const rewardEpoch = await this.rewardEpochManager.getRewardEpochForVotingEpochId(
      rewardEpochDuration.startVotingRoundId
    );
    if (options.initialize) {
      const rewardEpochInfo = getRewardEpochInfo(rewardEpoch);
      serializeRewardEpochInfo(rewardEpoch.rewardEpochId, rewardEpochInfo);
      setRewardCalculationStatus(
        options.rewardEpochId,
        RewardCalculationStatus.PENDING,
        rewardEpoch,
        rewardEpochDuration.endVotingRoundId
      );
      setRewardCalculationStatus(options.rewardEpochId, RewardCalculationStatus.IN_PROGRESS);
      recordProgress(options.rewardEpochId);
    }
    let start = options.startVotingRoundId ?? rewardEpochDuration.startVotingRoundId;
    let end = options.endVotingRoundId ?? rewardEpochDuration.endVotingRoundId;
    if (start < rewardEpochDuration.startVotingRoundId || start > rewardEpochDuration.endVotingRoundId) {
      throw new Error(`Invalid start voting round id: ${start}`);
    }
    if (end < rewardEpochDuration.startVotingRoundId || end > rewardEpochDuration.endVotingRoundId) {
      throw new Error(`Invalid end voting round id: ${end}`);
    }

    if (options.calculateClaims) {
      if (options.batchSize === undefined) {
        for (let votingRoundId = start; votingRoundId <= end; votingRoundId++) {
          try {
            logger.log(`Calculating claims for voting round: ${votingRoundId}`);
            await partialRewardClaimsForVotingRound(
              options.rewardEpochId,
              votingRoundId,
              RANDOM_GENERATION_BENCHING_WINDOW(),
              this.dataManager,
              undefined, // should be read from calculations folder
              false, // don't merge
              true, // add logs
              true //serializeResults
            );
          } catch (e) {
            this.logger.error(`Error while calculating reward claims for voting round ${votingRoundId}: ${e}`);
            // TODO: calculate expected time when data should be ready. If not, keep delaying for 10s
            const retryDelay = 10000; // 10s
            this.logger.log(`Sleeping for ${retryDelay / 1000} before retrying...`);
          }
        }
      }
      if (options.batchSize !== undefined && options.batchSize > 0) {
        logger.log("Using parallel processing");
        logger.log(options);
        logger.log("-------------------");
        const pool = workerPool.pool(__dirname + "/../claim-calculation-worker.js", {
          maxWorkers: 10, //options.numberOfWorkers,
        });
        const promises = [];
        for (let votingRoundId = start; votingRoundId <= end; votingRoundId += options.batchSize) {
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
            ...options,
            startVotingRoundId: votingRoundId,
            endVotingRoundId: endBatch,
            // set to undefined to avoid recursive use of pools
            batchSize: undefined,
            numberOfWorkers: undefined,
            // loggerFile,
            isWorker: true,
          };
          // logger.log(batchOptions);
          promises.push(pool.exec("run", [batchOptions]));
        }
        await Promise.all(promises);
        pool.terminate();
      }
    }

    if (options.aggregateClaims) {
      for (let votingRoundId = start; votingRoundId <= end; votingRoundId++) {
        logger.log(`Aggregating claims for voting round: ${votingRoundId}/${end}`);
        if (votingRoundId === rewardEpochDuration.startVotingRoundId) {
          aggregateRewardClaimsInStorage(
            rewardEpoch.rewardEpochId,
            rewardEpochDuration.startVotingRoundId,
            votingRoundId,
            true
          );
        } else {
          aggregateRewardClaimsInStorage(rewardEpoch.rewardEpochId, votingRoundId - 1, votingRoundId, true);
        }
      }
    }

    if (end === rewardEpochDuration.endVotingRoundId && options.aggregateClaims) {
      setRewardCalculationStatus(options.rewardEpochId, RewardCalculationStatus.DONE);
    }
    recordProgress(options.rewardEpochId);
  }
}
