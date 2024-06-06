import {
  granulatedPartialOfferMapForFastUpdates,
  granulatedPartialOfferMapForRandomFeedSelection
} from "../../../../libs/ftso-core/src/reward-calculation/reward-offers";
import {
  IFUPartialRewardOfferForRound,
  IPartialRewardOfferForRound
} from "../../../../libs/ftso-core/src/utils/PartialRewardOffer";
import { RewardEpochDuration } from "../../../../libs/ftso-core/src/utils/RewardEpochDuration";
import { FU_OFFERS_FILE, OFFERS_FILE } from "../../../../libs/ftso-core/src/utils/stat-info/constants";
import { serializeGranulatedPartialOfferMap } from "../../../../libs/ftso-core/src/utils/stat-info/granulated-partial-offers-map";
import {
  RewardEpochInfo,
  deserializeRewardEpochInfo
} from "../../../../libs/ftso-core/src/utils/stat-info/reward-epoch-info";
import { OptionalCommandOptions } from "../interfaces/OptionalCommandOptions";
import { extractRandomNumbers } from "./random-number-fixing-utils";

export async function fullRoundOfferCalculation(options: OptionalCommandOptions): Promise<void> {
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

  if (endVotingRoundId === undefined) {
    throw new Error(`No endVotingRound for ${rewardEpochId}`);
  }
  const randomNumbers: (bigint | undefined)[] = extractRandomNumbers(
    rewardEpochId,
    startVotingRoundId,
    endVotingRoundId
  );

  const rewardOfferMap: Map<
    number, Map<string, IPartialRewardOfferForRound[]>
  > = granulatedPartialOfferMapForRandomFeedSelection(
    startVotingRoundId,
    endVotingRoundId,
    rewardEpochInfo,
    randomNumbers
  );
  // sync call
  serializeGranulatedPartialOfferMap(rewardEpochDuration, rewardOfferMap, false, OFFERS_FILE);

  if (options.useFastUpdatesData) {
    const fuRewardOfferMap: Map<
      number, Map<string, IFUPartialRewardOfferForRound[]>
    > = granulatedPartialOfferMapForFastUpdates(rewardEpochInfo);
    serializeGranulatedPartialOfferMap(rewardEpochDuration, fuRewardOfferMap, false, FU_OFFERS_FILE);
  }
}

export function initializeTemplateOffers(rewardEpochInfo: RewardEpochInfo, endVotingRoundId: number) {
  const randomNumbers: (bigint | undefined)[] = [];
  const startVotingRoundId = rewardEpochInfo.signingPolicy.startVotingRoundId;
  for (let votingRoundId = startVotingRoundId; votingRoundId <= endVotingRoundId; votingRoundId++) {
    randomNumbers.push(BigInt(0));
  }
  const rewardEpochDuration: RewardEpochDuration = {
    rewardEpochId: rewardEpochInfo.rewardEpochId,
    startVotingRoundId,
    endVotingRoundId,
    expectedEndUsed: false,
  };

  const rewardOfferMap: Map<
    number, Map<string, IPartialRewardOfferForRound[]>
  > = granulatedPartialOfferMapForRandomFeedSelection(
    startVotingRoundId,
    endVotingRoundId,
    rewardEpochInfo,
    randomNumbers
  );
  serializeGranulatedPartialOfferMap(rewardEpochDuration, rewardOfferMap, false, OFFERS_FILE);
}
