import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import FakeTimers from "@sinonjs/fake-timers";
import { EntityManager } from "typeorm";
import { DataManagerForRewarding } from "../../../../libs/fsp-rewards/src/DataManagerForRewarding";
import { IndexerClientForRewarding } from "../../../../libs/fsp-rewards/src/IndexerClientForRewarding";
import { RewardEpochManager } from "../../../../libs/ftso-core/src/RewardEpochManager";
import { initializeRewardEpochStorage } from "../../../../libs/fsp-rewards/src/reward-calculation/reward-calculation";
import { RewardClaim } from "../../../../libs/fsp-rewards/src/utils/RewardClaim";
import { RewardEpochDuration } from "../../../../libs/ftso-core/src/utils/RewardEpochDuration";
import { deserializeAggregatedClaimsForVotingRoundId } from "../../../../libs/fsp-rewards/src/utils/stat-info/aggregated-claims";
import { serializeFinalRewardClaims } from "../../../../libs/fsp-rewards/src/utils/stat-info/final-reward-claims";
import { getIncrementalCalculationsTempRewards, serializeIncrementalCalculationsTempRewards } from "../../../../libs/fsp-rewards/src/utils/stat-info/incremental-calculation-temp-rewards";
import { recordProgress } from "../../../../libs/fsp-rewards/src/utils/stat-info/progress";
import {
  RewardCalculationStatus,
  deserializeRewardEpochCalculationStatus,
  rewardEpochCalculationStatusExists,
  setRewardCalculationStatus,
} from "../../../../libs/fsp-rewards/src/utils/stat-info/reward-calculation-status";
import { serializeRewardDistributionData } from "../../../../libs/fsp-rewards/src/utils/stat-info/reward-distribution-data";
import {
  deserializeRewardEpochInfo,
  getRewardEpochInfo,
  serializeRewardEpochInfo,
} from "../../../../libs/fsp-rewards/src/utils/stat-info/reward-epoch-info";
import { destroyStorage } from "../../../../libs/fsp-rewards/src/utils/stat-info/storage";
import { IncrementalCalculationState } from "../interfaces/IncrementalCalculationState";
import { OptionalCommandOptions } from "../interfaces/OptionalCommandOptions";
import {
  calculationOfRewardCalculationDataForRange,
  latestRewardEpochStart,
  tryFindNextRewardEpoch,
} from "../libs/calculator-utils";
import { calculateAndAggregateRemainingClaims, claimAggregation, fixRandomNumbersAndOffers } from "../libs/claim-utils";
import {
  cleanupAndReturnFinalEpochDuration,
  incrementalBatchCatchup,
  incrementalBatchClaimCatchup,
  incrementalExtendRewardEpochDuration,
} from "../libs/incremental-calculation-utils";
import { fullRoundOfferCalculation, initializeTemplateOffers } from "../libs/offer-utils";
import { runRandomNumberFixing } from "../libs/random-number-fixing-utils";
import { runCalculateRewardClaimsTopJob } from "../libs/reward-claims-calculation";
import { runCalculateRewardCalculationTopJob } from "../libs/reward-data-calculation";
import { getIncrementalCalculationsFeedSelections, serializeIncrementalCalculationsFeedSelections } from "../../../../libs/fsp-rewards/src/utils/stat-info/incremental-calculation-temp-selected-feeds";
import { calculateAttestationTypeAppearances } from "../libs/attestation-type-appearances";
import { calculateMinimalConditions } from "../../../../libs/fsp-rewards/src/reward-calculation/minimal-conditions/minimal-conditions";
import { writeDataProviderConditions } from "../../../../libs/fsp-rewards/src/reward-calculation/minimal-conditions/minimal-conditions-data";
import {BURN_ADDRESS, FUTURE_VOTING_ROUNDS} from "../../../../libs/fsp-rewards/src/constants";

if (process.env.FORCE_NOW) {
  const newNow = parseInt(process.env.FORCE_NOW) * 1000;
  FakeTimers.install({ now: newNow });
}

@Injectable()
export class CalculatorService {
  private readonly logger = new Logger(CalculatorService.name);
  // private readonly epochSettings: EpochSettings;
  public readonly indexerClient: IndexerClientForRewarding;
  private rewardEpochManager: RewardEpochManager;
  public readonly dataManager: DataManagerForRewarding;
  private entityManager: EntityManager;

  // Indexer top timeout margin
  private indexer_top_timeout: number;

  constructor(manager: EntityManager, configService: ConfigService) {
    this.entityManager = manager;
    const required_history_sec = configService.get<number>("required_indexer_history_time_sec");
    this.indexer_top_timeout = configService.get<number>("indexer_top_timeout");
    this.indexerClient = new IndexerClientForRewarding(manager, required_history_sec, this.logger);
    this.rewardEpochManager = new RewardEpochManager(this.indexerClient);
    this.dataManager = new DataManagerForRewarding(this.indexerClient, this.rewardEpochManager, this.logger);
  }

  /**
   * Performs incremental calculation of reward calculation data for the ongoing reward epoch.
   * It tries to detect current reward epoch from the system time.
   */
  async runRewardCalculationIncremental(options: OptionalCommandOptions): Promise<RewardEpochDuration> {
    const logger = new Logger();
    const rewardEpochId = await latestRewardEpochStart(this.indexerClient);
    logger.log(`Incremental calculation for reward epoch ${rewardEpochId}`);
    // TODO: recovery mode
    logger.log(`Destroying and recreating storage for reward epoch ${rewardEpochId}`);
    destroyStorage(rewardEpochId, options.tempRewardEpochFolder);
    // creates subfolders for voting rounds and distributes partial reward offers
    const [rewardEpochDuration, rewardEpoch] = await initializeRewardEpochStorage(
      rewardEpochId,
      this.rewardEpochManager,
      true, // useExpectedEndIfNoSigningPolicyAfter,
      false // tempRewardEpochFolder
    );
    if (rewardEpochDuration.endVotingRoundId === undefined) {
      // this should never happen
      throw new Error(`Invalid reward epoch duration for reward epoch ${rewardEpochId}`);
    }

    // endVotingRound is set to expected value
    // No fast updates data
    const rewardEpochInfo = getRewardEpochInfo(
      rewardEpoch,
      undefined, // endVotingRoundId - keep it unset
      undefined, // fuInflationRewardsOffered,
      undefined // fuIncentivesOfferedData
    );

    serializeRewardEpochInfo(rewardEpochId, rewardEpochInfo);
    setRewardCalculationStatus(
      rewardEpochId,
      RewardCalculationStatus.PENDING,
      rewardEpoch,
      rewardEpochDuration.endVotingRoundId
    );
    setRewardCalculationStatus(rewardEpochId, RewardCalculationStatus.IN_PROGRESS, undefined, undefined);
    recordProgress(rewardEpochId);

    initializeTemplateOffers(rewardEpochInfo, rewardEpochDuration.endVotingRoundId);

    // Calculate reward calculation data for initial voting rounds to catchup
    logger.log(`Incremental batch catchup for reward epoch ${rewardEpochId}`);
    const end = await incrementalBatchCatchup(rewardEpochDuration, options, logger);
    logger.log(`Incremental calculation for reward epoch ${rewardEpochId} starting from voting round ${end + 1}`);
    const state: IncrementalCalculationState = {
      rewardEpochId,
      votingRoundId: end,
      startVotingRoundId: rewardEpochDuration.startVotingRoundId,
      endVotingRoundId: rewardEpochDuration.endVotingRoundId,
      finalProcessedVotingRoundId: rewardEpochDuration.endVotingRoundId + FUTURE_VOTING_ROUNDS(),
      nextRewardEpochIdentified: false,
      maxVotingRoundIdFolder: rewardEpochDuration.endVotingRoundId,
      nextVotingRoundIdWithNoSecureRandom: rewardEpochDuration.startVotingRoundId,
      nextVotingRoundForClaimCalculation: rewardEpochDuration.startVotingRoundId,
      rewardEpochInfo,
    };
    fixRandomNumbersAndOffers(state, logger);

    const feedSelections = getIncrementalCalculationsFeedSelections(rewardEpochDuration.rewardEpochId, state.nextVotingRoundIdWithNoSecureRandom - 1);
    serializeIncrementalCalculationsFeedSelections(feedSelections);

    await incrementalBatchClaimCatchup(rewardEpochDuration, state, options, logger);
    for (
      let votingRoundId = rewardEpochDuration.startVotingRoundId;
      votingRoundId < state.nextVotingRoundForClaimCalculation;
      votingRoundId++
    ) {
      claimAggregation(rewardEpochDuration, votingRoundId, logger, true);
    }

    const tempClaimData = getIncrementalCalculationsTempRewards(rewardEpochDuration.rewardEpochId, state.nextVotingRoundForClaimCalculation - 1);
    serializeIncrementalCalculationsTempRewards(tempClaimData);

    state.votingRoundId = end + 1;
    while (state.votingRoundId <= state.finalProcessedVotingRoundId) {
      if (state.votingRoundId === state.finalProcessedVotingRoundId && !state.nextRewardEpochIdentified) {
        incrementalExtendRewardEpochDuration(state);
      }
      // keeps retrying until the voting round data are calculated
      await calculationOfRewardCalculationDataForRange(
        this.dataManager,
        state.rewardEpochId,
        state.votingRoundId,
        state.votingRoundId,
        options.retryDelayMs,
        logger,
        options.useFastUpdatesData,
        options.useFDCData
      );
      // The call above may create additional folder
      state.maxVotingRoundIdFolder = Math.max(state.maxVotingRoundIdFolder, state.votingRoundId);
      logger.log(`Processing implications for ${state.votingRoundId}`);
      // await fixRandomNumbersOffersAndCalculateClaims(this.dataManager, state, options, logger);
      fixRandomNumbersAndOffers(state, logger);

      const feedSelections = getIncrementalCalculationsFeedSelections(rewardEpochDuration.rewardEpochId, state.nextVotingRoundIdWithNoSecureRandom - 1);
      serializeIncrementalCalculationsFeedSelections(feedSelections);

      await calculateAndAggregateRemainingClaims(this.dataManager, state, options, logger);

      const tempClaimData = getIncrementalCalculationsTempRewards(rewardEpochDuration.rewardEpochId, state.nextVotingRoundForClaimCalculation - 1);
      serializeIncrementalCalculationsTempRewards(tempClaimData);

      recordProgress(rewardEpochId);

      state.votingRoundId++;
      await tryFindNextRewardEpoch(this.indexerClient, state, logger);
      if (state.nextRewardEpochIdentified && state.nextVotingRoundIdWithNoSecureRandom > state.endVotingRoundId) {
        break;
      }
    }
    const finalRewardEpochDuration = await cleanupAndReturnFinalEpochDuration(this.rewardEpochManager, state);
    setRewardCalculationStatus(rewardEpochId, RewardCalculationStatus.DONE);
    recordProgress(rewardEpochId);
    const lastClaims = deserializeAggregatedClaimsForVotingRoundId(rewardEpochId, state.endVotingRoundId);
    serializeFinalRewardClaims(rewardEpochId, lastClaims);
    const finalClaimsWithBurnsApplied = RewardClaim.mergeWithBurnClaims(lastClaims, BURN_ADDRESS);
    serializeRewardDistributionData(rewardEpochId, finalClaimsWithBurnsApplied);
    return finalRewardEpochDuration;
  }

  async fullRoundInitializationAndDataCalculationWithRandomFixing(options: OptionalCommandOptions): Promise<void> {
    const logger = new Logger();
    const adaptedOptions = {
      rewardEpochId: options.rewardEpochId,
      initialize: true,
      calculateRewardCalculationData: true,
      batchSize: options.batchSize,
      numberOfWorkers: options.numberOfWorkers,
      useFastUpdatesData: options.useFastUpdatesData,
      useFDCData: options.useFDCData,
    } as OptionalCommandOptions;
    const rewardEpochDuration = await runCalculateRewardCalculationTopJob(
      this.indexerClient,
      this.rewardEpochManager,
      adaptedOptions
    );
    const newOptions = { ...adaptedOptions };
    newOptions.endVotingRoundId = rewardEpochDuration.endVotingRoundId + FUTURE_VOTING_ROUNDS();
    newOptions.rewardEpochId = newOptions.rewardEpochId + 1;
    newOptions.tempRewardEpochFolder = true;
    newOptions.useExpectedEndIfNoSigningPolicyAfter = true;
    newOptions.useFastUpdatesData = false;
    newOptions.useFDCData = false;
    const rewardEpochDuration2 = await runCalculateRewardCalculationTopJob(
      this.indexerClient,
      this.rewardEpochManager,
      newOptions
    );
    logger.log(rewardEpochDuration2);
    await runRandomNumberFixing(options.rewardEpochId, FUTURE_VOTING_ROUNDS());
    destroyStorage(options.rewardEpochId + 1, true);
    calculateAttestationTypeAppearances(options.rewardEpochId);
  }

  async fullRoundClaimCalculation(options: OptionalCommandOptions): Promise<void> {
    const adaptedOptions = {
      rewardEpochId: options.rewardEpochId,
      calculateClaims: true,
      batchSize: options.batchSize,
      numberOfWorkers: options.numberOfWorkers,
      useFastUpdatesData: options.useFastUpdatesData,
      useFDCData: options.useFDCData,
    } as OptionalCommandOptions;
    await runCalculateRewardClaimsTopJob(adaptedOptions);
  }

  async fullRoundAggregateClaims(options: OptionalCommandOptions): Promise<void> {
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

    for (let votingRoundId = startVotingRoundId; votingRoundId <= endVotingRoundId; votingRoundId++) {
      claimAggregation(rewardEpochDuration, votingRoundId, logger);
    }

    setRewardCalculationStatus(rewardEpochId, RewardCalculationStatus.DONE);
    recordProgress(rewardEpochId);
    const lastClaims = deserializeAggregatedClaimsForVotingRoundId(rewardEpochId, endVotingRoundId);
    serializeFinalRewardClaims(rewardEpochId, lastClaims);
    const finalClaimsWithBurnsApplied = RewardClaim.mergeWithBurnClaims(lastClaims, BURN_ADDRESS);
    serializeRewardDistributionData(rewardEpochId, finalClaimsWithBurnsApplied);
  }

  async processOneRewardEpoch(options: OptionalCommandOptions): Promise<void> {
    if (options.calculateRewardCalculationData) {
      const adaptedOptions = { ...options };
      if (options.batchSize === undefined) {
        adaptedOptions.batchSize = 1;
      }
      if (options.numberOfWorkers === undefined) {
        adaptedOptions.numberOfWorkers = 1;
      }
      await this.fullRoundInitializationAndDataCalculationWithRandomFixing(adaptedOptions);
    }

    if (options.calculateOffers) {
      await fullRoundOfferCalculation(options);
    }

    if (options.calculateClaims) {
      await this.fullRoundClaimCalculation(options);
    }

    if (options.aggregateClaims) {
      await this.fullRoundAggregateClaims(options);
    }
  }

  processMinimalConditions(options: OptionalCommandOptions): void {
    if (options.rewardEpochId === undefined) {
      throw new Error("Reward epoch id is required for minimal conditions calculation");
    }
    const result = calculateMinimalConditions(options.rewardEpochId, false);
    writeDataProviderConditions(options.rewardEpochId, result);
  }
  /**
   * Returns a list of all (merged) reward claims for the given reward epoch.
   * Calculation can be quite intensive.
   */
  async run(options: OptionalCommandOptions): Promise<void> {
    const logger = new Logger();
    logger.log(options);
    if (options.minimalConditions) {
      this.processMinimalConditions(options);
      return;
    }
    if (options.rewardEpochId !== undefined) {
      await this.processOneRewardEpoch(options);
      return;
    }
    if (options.startRewardEpochId !== undefined) {
      const startRewardEpochId = options.startRewardEpochId;
      const latestRewardEpochId = await latestRewardEpochStart(this.indexerClient);
      if (latestRewardEpochId === undefined) {
        throw new Error("Critical error: No latest reward epoch found.");
      }
      const endRewardEpochId = Math.min(options.endRewardEpochId ?? Number.POSITIVE_INFINITY, latestRewardEpochId - 1);
      logger.log(`Processing reward epochs from ${startRewardEpochId} to ${endRewardEpochId}`);
      for (let rewardEpochId = startRewardEpochId; rewardEpochId <= endRewardEpochId; rewardEpochId++) {
        if (rewardEpochCalculationStatusExists(rewardEpochId)) {
          const status = deserializeRewardEpochCalculationStatus(rewardEpochId);
          if (status.calculationStatus === RewardCalculationStatus.DONE) {
            logger.log("Skipping reward epoch", rewardEpochId, "as it is already done");
            continue;
          }
        }
        logger.log(`Start processing reward epoch ${rewardEpochId}`);
        await this.processOneRewardEpoch({ ...options, rewardEpochId });
        logger.log(`End processing reward epoch ${rewardEpochId}`);
      }
      return;
    }
    if (options.incrementalCalculation) {
      while (true) {
        // Ends when the rewards for reward epoch are fully processed.
        await this.runRewardCalculationIncremental(options);
      }
    }
  }
}
