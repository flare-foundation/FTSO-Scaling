import { Logger } from "@nestjs/common";
import { DataManagerForRewarding } from "../../../../libs/ftso-core/src/DataManagerForRewarding";
import { IndexerClientForRewarding } from "../../../../libs/ftso-core/src/IndexerClientForRewarding";
import {
  CALCULATIONS_FOLDER,
  CONTRACTS,
  EPOCH_SETTINGS,
  FUTURE_VOTING_ROUNDS,
  RANDOM_GENERATION_BENCHING_WINDOW,
} from "../../../../libs/ftso-core/src/configs/networks";
import { RewardEpochStarted } from "../../../../libs/ftso-core/src/events";
import { prepareDataForRewardCalculationsForRange } from "../../../../libs/ftso-core/src/reward-calculation/reward-calculation";
import { fixOffersForRandomFeedSelection } from "../../../../libs/ftso-core/src/reward-calculation/reward-offers";
import { sleepFor } from "../../../../libs/ftso-core/src/utils/retry";
import { serializeRewardEpochInfo } from "../../../../libs/ftso-core/src/utils/stat-info/reward-epoch-info";
import { IncrementalCalculationState } from "../interfaces/IncrementalCalculationState";
import { extractRandomNumbers } from "./random-number-fixing-utils";
import { initializeTemplateOffers } from "./offer-utils";

/**
 * Checks into the indexer for the latest reward epoch start event and returns the reward epoch id.
 * It looks into the history of depth of 5 reward epoch lengths from now.
 */
export async function latestRewardEpochStart(
  indexerClient: IndexerClientForRewarding,
  HISTORY_DEPTH_IN_REWARD_EPOCHS = 5
): Promise<number | undefined> {
  const eventName = RewardEpochStarted.eventName;
  const historyDepth =
    EPOCH_SETTINGS().rewardEpochDurationInVotingEpochs *
    HISTORY_DEPTH_IN_REWARD_EPOCHS *
    EPOCH_SETTINGS().votingEpochDurationSeconds;
  const startTime = Math.floor(Date.now() / 1000) - historyDepth;
  const result = await indexerClient.queryEvents(CONTRACTS.FlareSystemsManager, eventName, startTime);
  const events = result.map(event => RewardEpochStarted.fromRawEvent(event));
  if (events.length > 0) {
    return events[events.length - 1].rewardEpochId;
  }
  return;
}

/**
 * Tries to find the next reward epoch signing policy event and to determine the actual end voting round id.
 * If the next reward epoch is found, offers get reinitialized and the state is updated.
 */
export async function tryFindNextRewardEpoch(
  indexerClient: IndexerClientForRewarding,
  state: IncrementalCalculationState,
  logger: Logger
): Promise<boolean> {
  if (!state.nextRewardEpochIdentified) return false;
  const lowestExpectedIndexerHistoryTime = await indexerClient.secureLowestTimestamp();
  const signingPolicyInitializedEvents = await indexerClient.getLatestSigningPolicyInitializedEvents(
    lowestExpectedIndexerHistoryTime
  );
  if (!signingPolicyInitializedEvents.data) {
    return false;
  }
  let i = signingPolicyInitializedEvents.data!.length - 1;
  while (i >= 0 && signingPolicyInitializedEvents.data![i].rewardEpochId > state.rewardEpochId + 1) {
    i--;
  }
  if (i >= 0 && signingPolicyInitializedEvents.data![i].rewardEpochId === state.rewardEpochId + 1) {
    const realEndVotingRoundId = signingPolicyInitializedEvents.data![i].startVotingRoundId - 1;

    state.rewardEpochInfo.endVotingRoundId = realEndVotingRoundId;
    serializeRewardEpochInfo(state.rewardEpochId, state.rewardEpochInfo);
    state.endVotingRoundId = realEndVotingRoundId;
    state.finalProcessedVotingRoundId = realEndVotingRoundId + FUTURE_VOTING_ROUNDS();
    if (state.endVotingRoundId !== realEndVotingRoundId) {
      logger.log(
        `New reward epoch identified: ${
          state.rewardEpochId + 1
        }. Real end voting round: ${realEndVotingRoundId} does not match the estimated/expected end voting round id: ${
          state.endVotingRoundId
        }.`
      );
      state.endVotingRoundId = realEndVotingRoundId;
      initializeTemplateOffers(state.rewardEpochInfo, state.endVotingRoundId);
      logger.log(`Offers reinitialized for reward epoch ${state.rewardEpochId + 1}.`);
      state.maxVotingRoundIdFolder = Math.max(state.maxVotingRoundIdFolder, state.endVotingRoundId);
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
      logger.log(`Offers fixed for reward epoch ${state.rewardEpochId + 1}.`);
      // reset claim calculation from start
      state.nextVotingRoundForClaimCalculation = state.startVotingRoundId;
    } else {
      logger.log(
        `Next reward epoch identified: ${
          state.rewardEpochId + 1
        }. Real end voting round: ${realEndVotingRoundId} matches the expected end voting round id.`
      );
    }
    state.nextRewardEpochIdentified = true;
  }
}

export async function calculationOfRewardCalculationDataForRange(
  dataManager: DataManagerForRewarding,
  rewardEpochId: number,
  firstVotingRoundId: number,
  lastVotingRoundId: number,
  retryDelayMs: number,
  logger: Logger,
  useFastUpdatesData: boolean,
  tempRewardEpochFolder = false,
  calculationFolder = CALCULATIONS_FOLDER()
) {
  let done = false;
  while (!done) {
    try {
      logger.log(
        `Calculating data for reward calculation for voting rounds: ${firstVotingRoundId}-${lastVotingRoundId}`
      );
      await prepareDataForRewardCalculationsForRange(
        rewardEpochId,
        firstVotingRoundId,
        lastVotingRoundId,
        RANDOM_GENERATION_BENCHING_WINDOW(),
        dataManager,
        useFastUpdatesData,
        tempRewardEpochFolder,
        calculationFolder
      );
      done = true;
    } catch (e) {
      // console.log(e);
      logger.error(
        `Error while calculating reward calculation data for voting rounds ${firstVotingRoundId}-${lastVotingRoundId} in reward epoch ${rewardEpochId}: ${e}`
      );
      // TODO: calculate expected time when data should be ready. If not, keep delaying for 10s
      const delay = retryDelayMs ?? 10000;
      logger.log(`Sleeping for ${delay / 1000}s before retrying...`);
      await sleepFor(delay);
    }
  }
}
