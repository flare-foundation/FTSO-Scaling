import { Logger } from "@nestjs/common";
import { DataManagerForRewarding } from "../../../../libs/ftso-core/src/DataManagerForRewarding";
import { RANDOM_GENERATION_BENCHING_WINDOW } from "../../../../libs/ftso-core/src/configs/networks";
import {
  aggregateRewardClaimsInStorage,
  partialRewardClaimsForVotingRound,
} from "../../../../libs/ftso-core/src/reward-calculation/reward-calculation";
import { fixOffersForRandomFeedSelection } from "../../../../libs/ftso-core/src/reward-calculation/reward-offers";
import { RewardEpochDuration } from "../../../../libs/ftso-core/src/utils/RewardEpochDuration";
import { sleepFor } from "../../../../libs/ftso-core/src/utils/retry";
import { getIncrementalCalculationsTempRewards, serializeIncrementalCalculationsTempRewards } from "../../../../libs/ftso-core/src/utils/stat-info/incremental-calculation-temp-rewards";
import { recordProgress } from "../../../../libs/ftso-core/src/utils/stat-info/progress";
import { IncrementalCalculationState } from "../interfaces/IncrementalCalculationState";
import { OptionalCommandOptions } from "../interfaces/OptionalCommandOptions";
import { extractRandomNumbers, processRandomNumberFixingRange } from "./random-number-fixing-utils";

// claims

export function claimAggregation(rewardEpochDuration: RewardEpochDuration, votingRoundId: number, logger: Logger, recordTempIncrementalRewards = false) {
  logger.log(`Aggregating claims for voting round: ${votingRoundId}`);
  if (votingRoundId === rewardEpochDuration.startVotingRoundId) {
    aggregateRewardClaimsInStorage(rewardEpochDuration.rewardEpochId, votingRoundId, votingRoundId, true);
  } else {
    aggregateRewardClaimsInStorage(rewardEpochDuration.rewardEpochId, votingRoundId - 1, votingRoundId, false);
  }
  if(recordTempIncrementalRewards) {
    const data = getIncrementalCalculationsTempRewards(rewardEpochDuration.rewardEpochId, votingRoundId);
    serializeIncrementalCalculationsTempRewards(data);
  }
}

export async function calculateClaimsAndAggregate(
  dataManager: DataManagerForRewarding,
  rewardEpochDuration: RewardEpochDuration,
  votingRoundId: number,
  aggregateClaims: boolean,
  retryDelayMs: number,
  logger: Logger,
  useFastUpdatesData: boolean,
  keepRetrying = false
) {
  let done = false;
  while (!done) {
    // eslint-disable-next-line no-useless-catch
    try {
      logger.log(`Calculating claims for voting round: ${votingRoundId}`);
      await partialRewardClaimsForVotingRound(
        rewardEpochDuration.rewardEpochId,
        votingRoundId,
        RANDOM_GENERATION_BENCHING_WINDOW(),
        dataManager,
        undefined, // should be read from calculations folder
        false, // reward calculation data should be already calculated
        false, // don't merge
        true, //serializeResults
        useFastUpdatesData,
        logger
      );
      if (aggregateClaims) {
        claimAggregation(rewardEpochDuration, votingRoundId, logger);
      }
      done = true;
    } catch (e) {
      logger.error(
        `Error while calculating reward claims for voting round ${votingRoundId} in reward epoch ${rewardEpochDuration.rewardEpochId}: ${e}`
      );
      if (!keepRetrying) {
        throw e;
      }
      // TODO: calculate expected time when data should be ready. If not, keep delaying for 10s
      const delay = retryDelayMs ?? 10000;
      logger.log(`Sleeping for ${delay / 1000}s before retrying...`);
      await sleepFor(delay);
    }
  }
}

export function fixRandomNumbersAndOffers(state: IncrementalCalculationState, logger: Logger) {
  // fix random numbers
  const lastNextVotingRoundIdWithNoSecureRandom = state.nextVotingRoundIdWithNoSecureRandom;
  state.nextVotingRoundIdWithNoSecureRandom = processRandomNumberFixingRange(
    state.rewardEpochId,
    state.nextVotingRoundIdWithNoSecureRandom,
    state.votingRoundId,
    logger
  );
  if (state.nextVotingRoundIdWithNoSecureRandom > lastNextVotingRoundIdWithNoSecureRandom) {
    // fix offers
    const randomNumbers = extractRandomNumbers(
      state.rewardEpochId,
      lastNextVotingRoundIdWithNoSecureRandom,
      state.nextVotingRoundIdWithNoSecureRandom - 1
    );
    fixOffersForRandomFeedSelection(
      state.rewardEpochId,
      lastNextVotingRoundIdWithNoSecureRandom,
      state.nextVotingRoundIdWithNoSecureRandom - 1,
      state.rewardEpochInfo,
      randomNumbers
    );
    logger.log(
      `Offers fixed for reward epoch ${state.rewardEpochId + 1
      } from voting rounds ${lastNextVotingRoundIdWithNoSecureRandom}-${state.nextVotingRoundIdWithNoSecureRandom - 1}.`
    );
  }
}

export async function calculateAndAggregateRemainingClaims(
  dataManager: DataManagerForRewarding,
  state: IncrementalCalculationState,
  options: OptionalCommandOptions,
  logger: Logger
) {
  const rewardEpochDuration: RewardEpochDuration = {
    rewardEpochId: state.rewardEpochInfo.rewardEpochId,
    startVotingRoundId: state.startVotingRoundId,
    endVotingRoundId: state.endVotingRoundId,
    expectedEndUsed: false,
  };

  for (
    let tmpVotingRoundId = state.nextVotingRoundForClaimCalculation;
    tmpVotingRoundId < state.nextVotingRoundIdWithNoSecureRandom;
    tmpVotingRoundId++
  ) {
    await calculateClaimsAndAggregate(
      dataManager,
      rewardEpochDuration,
      tmpVotingRoundId,
      true, // aggregate
      options.retryDelayMs,
      logger,
      false //options.useFastUpdatesData
    );
    

    logger.log(`Claims calculated for voting round ${tmpVotingRoundId}.`);
    recordProgress(state.rewardEpochId);
  }
  state.nextVotingRoundForClaimCalculation = state.nextVotingRoundIdWithNoSecureRandom;
}
