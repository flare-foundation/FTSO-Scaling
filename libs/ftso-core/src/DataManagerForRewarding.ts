import { DataAvailabilityStatus, DataManager, DataMangerResponse, SignAndFinalizeSubmissionData } from "./DataManager";
import { BlockAssuranceResult } from "./IndexerClient";
import { IndexerClientForRewarding } from "./IndexerClientForRewarding";
import { RewardEpoch } from "./RewardEpoch";
import { RewardEpochManager } from "./RewardEpochManager";
import { ContractMethodNames } from "./configs/contracts";
import { ADDITIONAL_REWARDED_FINALIZATION_WINDOWS, EPOCH_SETTINGS, FTSO2_PROTOCOL_ID } from "./configs/networks";
import {
  DataForCalculations,
  DataForRewardCalculation,
  FastUpdatesDataForVotingRound,
} from "./data-calculation-interfaces";
import { ILogger } from "./utils/ILogger";

/**
 * Helps in extracting data in a consistent way for FTSO scaling feed median calculations, random number calculation and rewarding.
 * It uses indexerClient to query data from c chain indexer database
 * It uses rewardEpochManager to get correct reward epoch configuration for a given voting round id
 * It uses EPOCH_SETTINGS to get manage timestamp to voting round id conversions
 */
export class DataManagerForRewarding extends DataManager {
  constructor(
    protected readonly indexerClient: IndexerClientForRewarding,
    protected readonly rewardEpochManager: RewardEpochManager,
    protected readonly logger: ILogger
  ) {
    super(indexerClient, rewardEpochManager, logger);
  }

  /**
   * Prepare data for median calculation and rewarding given the voting round id and the random generation benching window.
   *  - queries relevant commits and reveals from chain indexer database
   *  - filters out leaving valid and matching commits and reveals pairs
   *  - filters out leaving commits and reveals by eligible voters in the current reward epoch
   *  - calculates reveal offenders in the voting round id
   *  - calculates all reveal offenders in the random generation benching window (@param votingRoundId - @param randomGenerationBenchingWindow, @param votingRoundId - 1)
   */
  public async getDataForCalculationsForVotingRoundRange(
    firstVotingRoundId: number,
    lastVotingRoundId: number,
    randomGenerationBenchingWindow: number,
    endTimeout?: number
  ): Promise<DataMangerResponse<DataForCalculations[]>> {
    const startVotingRoundId = firstVotingRoundId - randomGenerationBenchingWindow;
    const endVotingRoundId = lastVotingRoundId;
    const mappingsResponse = await this.getCommitAndRevealMappingsForVotingRoundRange(
      startVotingRoundId,
      endVotingRoundId,
      endTimeout
    );
    if (
      mappingsResponse.status === DataAvailabilityStatus.NOT_OK ||
      (mappingsResponse.status === DataAvailabilityStatus.TIMEOUT_OK && !endTimeout)
    ) {
      this.logger.warn(
        `No commit reveal mappings found for voting round range ${startVotingRoundId} - ${endVotingRoundId}`
      );
      return {
        status: mappingsResponse.status,
      };
    }
    const result: DataForCalculations[] = [];
    const firstRewardEpoch = await this.rewardEpochManager.getRewardEpochForVotingEpochId(startVotingRoundId);
    const lastRewardEpoch = await this.rewardEpochManager.getRewardEpochForVotingEpochId(endVotingRoundId);
    if (!firstRewardEpoch || !lastRewardEpoch) {
      this.logger.warn(`No reward epoch found for voting round range ${startVotingRoundId} - ${endVotingRoundId}`);
      return {
        status: DataAvailabilityStatus.NOT_OK,
      };
    }
    if (lastRewardEpoch.rewardEpochId - firstRewardEpoch.rewardEpochId > 1) {
      this.logger.warn(
        `Reward epochs are not consecutive for voting round range ${startVotingRoundId} - ${endVotingRoundId}`
      );
      return {
        status: DataAvailabilityStatus.NOT_OK,
      };
    }

    async function rewardEpochForVotingRoundId(votingRoundId: number): Promise<RewardEpoch> {
      if (votingRoundId < lastRewardEpoch.startVotingRoundId) {
        return firstRewardEpoch;
      }
      return lastRewardEpoch;
    }

    for (let votingRoundId = firstVotingRoundId; votingRoundId <= lastVotingRoundId; votingRoundId++) {
      const commits = mappingsResponse.data.votingRoundIdToCommits.get(votingRoundId) || [];
      const reveals = mappingsResponse.data.votingRoundIdToReveals.get(votingRoundId) || [];
      // this.logger.debug(`Commits for voting round ${votingRoundId}: ${JSON.stringify(commits)}`);
      // this.logger.debug(`Reveals for voting round ${votingRoundId}: ${JSON.stringify(reveals)}`);

      const rewardEpoch = await rewardEpochForVotingRoundId(votingRoundId);
      const votersToCommitsAndReveals = this.getVoterToLastCommitAndRevealMapsForVotingRound(
        votingRoundId,
        commits,
        reveals,
        rewardEpoch.canonicalFeedOrder
      );
      const partialData = this.getDataForCalculationsPartial(votersToCommitsAndReveals, rewardEpoch);
      const benchingWindowRevealOffenders = await this.getBenchingWindowRevealOffenders(
        votingRoundId,
        rewardEpoch.rewardEpochId,
        rewardEpoch.startVotingRoundId,
        mappingsResponse.data.votingRoundIdToCommits,
        mappingsResponse.data.votingRoundIdToReveals,
        randomGenerationBenchingWindow,
        (votingRoundId: number) => rewardEpochForVotingRoundId(votingRoundId)
      );
      if (!process.env.REMOVE_ANNOYING_MESSAGES) {
        this.logger.debug(`Valid reveals from: ${JSON.stringify(Array.from(partialData.validEligibleReveals.keys()))}`);
      }
      const dataForRound = {
        ...partialData,
        randomGenerationBenchingWindow,
        benchingWindowRevealOffenders,
        rewardEpoch,
      } as DataForCalculations;
      result.push(dataForRound);
    }
    return {
      status: mappingsResponse.status,
      data: result as DataForCalculations[],
    };
  }

  /**
   * Provides the data for reward calculation given the voting round id and the random generation benching window.
   * Since calculation of rewards takes place when all the data is surely on the blockchain, no timeout queries are relevant here.
   * The data for reward calculation is composed of:
   * - data for median calculation
   * - signatures for the given voting round id in given rewarding window
   * - finalizations for the given voting round id in given rewarding window
   * Data for median calculation is used to calculate the median feed value for each feed in the rewarding boundaries.
   * The data also contains the RewardEpoch objects, which contains all reward offers.
   * Signatures and finalizations are used to calculate the rewards for signature deposition and finalizations.
   * Each finalization is checked if it is valid and finalizable. Note that only one such finalization is fully executed on chain, while
   * others are reverted. Nevertheless, all finalizations in rewarded window are considered for the reward calculation, since a certain
   * subset is eligible for a reward if submitted in due time.
   */
  public async getDataForRewardCalculationForVotingRoundRange(
    firstVotingRoundId: number,
    lastVotingRoundId: number,
    randomGenerationBenchingWindow: number,
    useFastUpdatesData: boolean
  ): Promise<DataMangerResponse<DataForRewardCalculation[]>> {
    const dataForCalculationsResponse = await this.getDataForCalculationsForVotingRoundRange(
      firstVotingRoundId,
      lastVotingRoundId,
      randomGenerationBenchingWindow
    );
    if (dataForCalculationsResponse.status !== DataAvailabilityStatus.OK) {
      return {
        status: dataForCalculationsResponse.status,
      };
    }
    const signaturesResponse = await this.getSignAndFinalizeSubmissionDataForVotingRoundRange(
      firstVotingRoundId,
      lastVotingRoundId
    );
    if (signaturesResponse.status !== DataAvailabilityStatus.OK) {
      return {
        status: signaturesResponse.status,
      };
    }
    let fastUpdatesData: FastUpdatesDataForVotingRound[] = [];
    if (useFastUpdatesData) {
      const fastUpdatesDataResponse = await this.getFastUpdatesDataForVotingRoundRange(
        firstVotingRoundId,
        lastVotingRoundId
      );
      if (fastUpdatesDataResponse.status !== DataAvailabilityStatus.OK) {
        return {
          status: fastUpdatesDataResponse.status,
        };
      }
      fastUpdatesData = fastUpdatesDataResponse.data;
    }
    const result: DataForRewardCalculation[] = [];
    let startIndexSignatures = 0;
    let endIndexSignatures = 0;
    let startIndexFinalizations = 0;
    let endIndexFinalizations = 0;
    for (let votingRoundId = firstVotingRoundId; votingRoundId <= lastVotingRoundId; votingRoundId++) {
      const startTime = EPOCH_SETTINGS().revealDeadlineSec(votingRoundId + 1) + 1;
      const endTime = EPOCH_SETTINGS().votingEpochEndSec(votingRoundId + 1 + ADDITIONAL_REWARDED_FINALIZATION_WINDOWS);
      while (
        startIndexSignatures < signaturesResponse.data.signatures.length &&
        signaturesResponse.data.signatures[startIndexSignatures].timestamp < startTime
      ) {
        startIndexSignatures++;
      }
      while (
        endIndexSignatures < signaturesResponse.data.signatures.length &&
        signaturesResponse.data.signatures[endIndexSignatures].timestamp < endTime
      ) {
        endIndexSignatures++;
      }
      while (
        startIndexFinalizations < signaturesResponse.data.finalizations.length &&
        signaturesResponse.data.finalizations[startIndexFinalizations].timestamp < startTime
      ) {
        startIndexFinalizations++;
      }
      while (
        endIndexFinalizations < signaturesResponse.data.finalizations.length &&
        signaturesResponse.data.finalizations[endIndexFinalizations].timestamp < endTime
      ) {
        endIndexFinalizations++;
      }

      const dataForCalculations = dataForCalculationsResponse.data[votingRoundId - firstVotingRoundId];
      const rewardEpoch = dataForCalculations.rewardEpoch;
      const votingRoundSignatures = signaturesResponse.data.signatures.slice(startIndexSignatures, endIndexSignatures);
      const votingRoundFinalizations = signaturesResponse.data.finalizations.slice(
        startIndexFinalizations,
        endIndexFinalizations
      );
      const signatures = DataManager.extractSignatures(
        votingRoundId,
        rewardEpoch,
        votingRoundSignatures,
        FTSO2_PROTOCOL_ID,
        this.logger
      );
      const finalizations = this.extractFinalizations(
        votingRoundId,
        rewardEpoch,
        votingRoundFinalizations,
        FTSO2_PROTOCOL_ID
      );
      const firstSuccessfulFinalization = finalizations.find(finalization => finalization.successfulOnChain);
      const dataForRound: DataForRewardCalculation = {
        dataForCalculations,
        signatures,
        finalizations,
        firstSuccessfulFinalization,
        fastUpdatesData: fastUpdatesData[votingRoundId - firstVotingRoundId],
      };
      result.push(dataForRound);
    }
    return {
      status: DataAvailabilityStatus.OK,
      data: result,
    };
  }

  /**
   * Extract signatures and finalizations for the given voting round id from indexer database.
   * This function is used for reward calculation, which is executed at the time when all the data
   * is surely on the blockchain. Nevertheless the data availability is checked. Timeout queries are
   * not relevant here. The transactions are taken from the rewarded window for each
   * voting round. The rewarded window starts at the reveal deadline which is in votingEpochId = votingRoundId + 1.
   * The end of the rewarded window is the end of voting epoch with
   * votingEpochId = votingRoundId + 1 + ADDITIONAL_REWARDED_FINALIZATION_WINDOWS.
   * Rewarding will consider submissions are finalizations only in the rewarding window and this function
   * queries exactly those.
   * @param votingRoundId
   * @returns
   */
  protected async getSignAndFinalizeSubmissionDataForVotingRoundRange(
    firstVotingRoundId: number,
    lastVotingRoundId: number
  ): Promise<DataMangerResponse<SignAndFinalizeSubmissionData>> {
    const submitSignaturesSubmissionResponse = await this.indexerClient.getSubmissionDataInRange(
      ContractMethodNames.submitSignatures,
      EPOCH_SETTINGS().revealDeadlineSec(firstVotingRoundId + 1) + 1,
      EPOCH_SETTINGS().votingEpochEndSec(lastVotingRoundId + 1 + ADDITIONAL_REWARDED_FINALIZATION_WINDOWS)
    );
    if (submitSignaturesSubmissionResponse.status !== BlockAssuranceResult.OK) {
      return {
        status: DataAvailabilityStatus.NOT_OK,
      };
    }
    const signatures = submitSignaturesSubmissionResponse.data;
    DataManager.sortSubmissionDataArray(signatures);
    // Finalization data only on the rewarded range
    const submitFinalizeSubmissionResponse = await this.indexerClient.getFinalizationDataInRange(
      EPOCH_SETTINGS().revealDeadlineSec(firstVotingRoundId + 1) + 1,
      EPOCH_SETTINGS().votingEpochEndSec(lastVotingRoundId + 1 + ADDITIONAL_REWARDED_FINALIZATION_WINDOWS)
    );
    if (submitFinalizeSubmissionResponse.status !== BlockAssuranceResult.OK) {
      return {
        status: DataAvailabilityStatus.NOT_OK,
      };
    }
    const finalizations = submitFinalizeSubmissionResponse.data;
    DataManager.sortSubmissionDataArray(finalizations);
    return {
      status: DataAvailabilityStatus.OK,
      data: {
        signatures,
        finalizations,
      },
    };
  }

  public async getFastUpdatesDataForVotingRoundRange(
    firstVotingRoundId: number,
    lastVotingRoundId: number
  ): Promise<DataMangerResponse<FastUpdatesDataForVotingRound[]>> {
    const feedValuesResponse = await this.indexerClient.getFastUpdateFeedsEvents(firstVotingRoundId, lastVotingRoundId);
    if (feedValuesResponse.status !== BlockAssuranceResult.OK) {
      return {
        status: DataAvailabilityStatus.NOT_OK,
      };
    }
    const feedUpdates = await this.indexerClient.getFastUpdateFeedsSubmittedEvents(
      firstVotingRoundId,
      lastVotingRoundId
    );
    if (feedUpdates.status !== BlockAssuranceResult.OK) {
      return {
        status: DataAvailabilityStatus.NOT_OK,
      };
    }
    const result: FastUpdatesDataForVotingRound[] = [];
    for (let votingRoundId = firstVotingRoundId; votingRoundId <= lastVotingRoundId; votingRoundId++) {
      const fastUpdateFeeds = feedValuesResponse.data[votingRoundId - firstVotingRoundId];
      const fastUpdateSubmissions = feedUpdates.data[votingRoundId - firstVotingRoundId];
      const value: FastUpdatesDataForVotingRound = {
        votingRoundId,
        feedValues: fastUpdateFeeds.feeds,
        feedDecimals: fastUpdateFeeds.decimals,
        signingPolicyAddressesSubmitted: fastUpdateSubmissions.map(submission => submission.signingPolicyAddress),
      };
      result.push(value);
    }
    return {
      status: DataAvailabilityStatus.OK,
      data: result,
    };
  }
}
