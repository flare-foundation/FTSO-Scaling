import { BURN_ADDRESS, FINALIZATION_BIPS, SIGNING_BIPS, TOTAL_BIPS } from "../configs/networks";
import { InflationRewardsOffered } from "../events";
import {
  IFUPartialRewardOfferForRound,
  IPartialRewardOfferForEpoch,
  IPartialRewardOfferForRound,
  PartialRewardOffer,
} from "../utils/PartialRewardOffer";
import { RewardEpochDuration } from "../utils/RewardEpochDuration";
import { OFFERS_FILE } from "../utils/stat-info/constants";
import {
  deserializeGranulatedPartialOfferMap,
  serializeGranulatedPartialOfferMap,
} from "../utils/stat-info/granulated-partial-offers-map";
import { RewardEpochInfo } from "../utils/stat-info/reward-epoch-info";

/**
 * A split of partial reward offer into three parts:
 */
export interface SplitRewardOffer<T> {
  readonly medianRewardOffer: T;
  readonly signingRewardOffer: T;
  readonly finalizationRewardOffer: T;
}

/**
 * Creates partial reward offers for feeds from inflation reward offer.
 * Currently only equally distributed inflation reward offers are supported (mode === 0)
 */
export function distributeInflationRewardOfferToFeeds(
  inflationRewardOffer: InflationRewardsOffered
): IPartialRewardOfferForEpoch[] {
  if (inflationRewardOffer.mode === 0) {
    return PartialRewardOffer.fromInflationRewardOfferedEquallyDistributed(inflationRewardOffer);
  }
  throw new Error(`Mode ${inflationRewardOffer.mode} is not supported`);
}

export function adaptCommunityRewardOffer(rewardOffer: IPartialRewardOfferForEpoch): void {
  rewardOffer.minRewardedTurnoutBIPS = 0;
  rewardOffer.primaryBandRewardSharePPM = 1000000;
  rewardOffer.secondaryBandWidthPPM = 0;
  rewardOffer.isInflation = false;
  rewardOffer.claimBackAddress = BURN_ADDRESS;
}

/**
 * Given a reward epoch info and random numbers for each voting round, creates a map of partial reward offers for each voting round and feed.
 * If @param provideAllOptions is set to false only one feed is chosen using the random number provided and one offer per voting round is
 * generated. If the random number is undefined, the offer is marked for burning.
 * If @param provideAllOptions is set to true, offers for all feeds will be provided for each voting round with the same share of the reward as
 * it would be used for the selected feed. This enables the later selection by random number. In this case there is also no offers marked for
 * burning.
 */
export function granulatedPartialOfferMapForRandomFeedSelection(
  startVotingRoundId: number,
  endVotingRoundId: number,
  rewardEpochInfo: RewardEpochInfo,
  randomNumbers: (bigint | undefined)[],
  provideAllOptions = false
): Map<number, Map<string, IPartialRewardOfferForRound[]>> {
  if (randomNumbers.length !== endVotingRoundId - startVotingRoundId + 1) {
    throw new Error(
      `Random numbers length ${randomNumbers.length} does not match voting rounds length ${
        endVotingRoundId - startVotingRoundId + 1
      }`
    );
  }
  // Calculate total amount of rewards for the reward epoch
  let totalAmount = 0n;
  for (const rewardOffer of rewardEpochInfo.rewardOffers.rewardOffers) {
    totalAmount += rewardOffer.amount;
  }
  for (const inflationOffer of rewardEpochInfo.rewardOffers.inflationOffers) {
    totalAmount += inflationOffer.amount;
  }
  // Create a map of feedId -> rewardOffer for easier access
  const currencyRewardOffers = new Map<string, IPartialRewardOfferForEpoch>();
  for (const inflationRewardOffer of rewardEpochInfo.rewardOffers.inflationOffers) {
    // amounts will be ignored
    const feedOffers = PartialRewardOffer.fromInflationRewardOfferedEquallyDistributed(inflationRewardOffer);
    for (const feedOffer of feedOffers) {
      if (currencyRewardOffers.has(feedOffer.feedId)) {
        console.log(
          `Duplicate feed inflation offer for feed ${feedOffer.feedId}. Only the configuration of the last one will be used.`
        );
      }
      currencyRewardOffers.set(feedOffer.feedId, feedOffer); // always use the last configuration only
    }
  }
  for (const rewardOffer of rewardEpochInfo.rewardOffers.rewardOffers) {
    if (currencyRewardOffers.has(rewardOffer.feedId)) {
      console.log(`Duplicate community reward offer for feed ${rewardOffer.feedId}. Only the first one is considered.`);
    } else {
      const adaptedCommunityOffer = PartialRewardOffer.fromRewardOffered(rewardOffer);
      adaptCommunityRewardOffer(adaptedCommunityOffer);
      currencyRewardOffers.set(rewardOffer.feedId, PartialRewardOffer.fromRewardOffered(rewardOffer));
    }
  }
  // Create a map of votingRoundId -> feedId -> rewardOffer
  // Note that the second level dictionary has only one key and the value is array of length one, containing full reward for the
  // voting round and randomly selected feed.
  const rewardOfferMap = new Map<number, Map<string, IPartialRewardOfferForRound[]>>();
  const numberOfVotingRounds = endVotingRoundId - startVotingRoundId + 1;
  const sharePerOne: bigint = totalAmount / BigInt(numberOfVotingRounds);
  const remainder: number = Number(totalAmount % BigInt(numberOfVotingRounds));

  for (let votingRoundId = startVotingRoundId; votingRoundId <= endVotingRoundId; votingRoundId++) {
    if (provideAllOptions) {
      for (const feed of rewardEpochInfo.canonicalFeedOrder) {
        const feedId = feed.id;
        const feedOffer = currencyRewardOffers.get(feedId);
        if (!feedOffer) {
          throw new Error(`Feed ${feedId} is missing in reward offers`);
        }
        // Create adapted offer with selected feed
        const feedOfferForVoting: IPartialRewardOfferForRound = {
          ...feedOffer,
          votingRoundId,
          // all get the same amount, as only one will be chosen.
          amount: sharePerOne + (votingRoundId - startVotingRoundId < remainder ? 1n : 0n),
        };
        const feedOffers = rewardOfferMap.get(votingRoundId) || new Map<string, IPartialRewardOfferForRound[]>();
        rewardOfferMap.set(votingRoundId, feedOffers);
        const feedIdOffers = feedOffers.get(feedId) || [];
        feedOffers.set(feedId, feedIdOffers);
        feedIdOffers.push(feedOfferForVoting);
      }
      continue;
    }
    const randomNumber = randomNumbers[votingRoundId - startVotingRoundId];
    // if random number is undefined, just choose the first feed. The offer will be burned anyway.
    const selectedFeedIndex =
      randomNumber === undefined ? 0 : Number(randomNumber % BigInt(rewardEpochInfo.canonicalFeedOrder.length));
    const selectedFeed = rewardEpochInfo.canonicalFeedOrder[selectedFeedIndex];
    const selectedFeedId = selectedFeed.id;
    const selectedFeedOffer = currencyRewardOffers.get(selectedFeedId);
    if (!selectedFeedOffer) {
      throw new Error(`Feed ${selectedFeedId} is missing in reward offers`);
    }
    // Create adapted offer with selected feed
    const feedOfferForVoting: IPartialRewardOfferForRound = {
      ...selectedFeedOffer,
      votingRoundId,
      amount: sharePerOne + (votingRoundId - startVotingRoundId < remainder ? 1n : 0n),
    };
    // Mark offer for full burning
    if (randomNumber === undefined) {
      feedOfferForVoting.shouldBeBurned = true;
    }
    const feedOffers = rewardOfferMap.get(votingRoundId) || new Map<string, IPartialRewardOfferForRound[]>();
    rewardOfferMap.set(votingRoundId, feedOffers);
    const feedIdOffers = feedOffers.get(selectedFeedId) || [];
    feedOffers.set(selectedFeedId, feedIdOffers);
    feedIdOffers.push(feedOfferForVoting);
  }
  return rewardOfferMap;
}

export function fixOffersForRandomFeedSelection(
  rewardEpochId: number,
  startVotingRoundId: number,
  endVotingRoundId: number,
  rewardEpochInfo: RewardEpochInfo,
  randomNumbers: (bigint | undefined)[]
) {
  if (randomNumbers.length !== endVotingRoundId - startVotingRoundId + 1) {
    throw new Error(
      `Random numbers length ${randomNumbers.length} does not match voting rounds length ${
        endVotingRoundId - startVotingRoundId + 1
      }`
    );
  }

  const rewardOfferMap = new Map<number, Map<string, IPartialRewardOfferForRound[]>>();

  for (let votingRoundId = startVotingRoundId; votingRoundId <= endVotingRoundId; votingRoundId++) {
    const randomNumber = randomNumbers[votingRoundId - startVotingRoundId];
    // if random number is undefined, just choose the first feed. The offer will be burned anyway.
    const selectedFeedIndex =
      randomNumber === undefined ? 0 : Number(randomNumber % BigInt(rewardEpochInfo.canonicalFeedOrder.length));
    const selectedFeed = rewardEpochInfo.canonicalFeedOrder[selectedFeedIndex];
    const selectedFeedId = selectedFeed.id;

    const currentRewardOffersMap = deserializeGranulatedPartialOfferMap(rewardEpochId, votingRoundId);
    const newRewardOfferMap = new Map<string, IPartialRewardOfferForRound[]>();
    const newRewardOffers: IPartialRewardOfferForRound[] = [];
    const offer = currentRewardOffersMap.get(selectedFeedId)?.[0];
    if (!offer) {
      throw new Error(`Feed ${selectedFeedId} is missing in reward offers`);
    }
    if (randomNumber === undefined) {
      offer.shouldBeBurned = true;
    }
    newRewardOffers.push(offer);
    newRewardOfferMap.set(selectedFeedId, newRewardOffers);
    rewardOfferMap.set(votingRoundId, newRewardOfferMap);
  }
  const adaptedRewardEpochDuration: RewardEpochDuration = {
    rewardEpochId,
    startVotingRoundId,
    endVotingRoundId,
    expectedEndUsed: false,
  };
  serializeGranulatedPartialOfferMap(adaptedRewardEpochDuration, rewardOfferMap, false, OFFERS_FILE);
}

/**
 * Splits a partial reward offer into three parts: median, signing and finalization.
 * These split offers are used as inputs into reward calculation for specific types
 * of rewards.
 */
export function splitRewardOfferByTypes<T extends IPartialRewardOfferForEpoch>(offer: T): SplitRewardOffer<T> {
  const forSigning = (offer.amount * SIGNING_BIPS()) / TOTAL_BIPS;
  const forFinalization = (offer.amount * FINALIZATION_BIPS()) / TOTAL_BIPS;
  const forMedian = offer.amount - forSigning - forFinalization;
  const result: SplitRewardOffer<T> = {
    medianRewardOffer: {
      ...offer,
      amount: forMedian,
    },
    signingRewardOffer: {
      ...offer,
      amount: forSigning,
    },
    finalizationRewardOffer: {
      ...offer,
      amount: forFinalization,
    },
  };
  return result;
}

export function granulatedPartialOfferMapForFastUpdates(
  rewardEpochInfo: RewardEpochInfo
): Map<number, Map<string, IFUPartialRewardOfferForRound[]>> {
  const startVotingRoundId = rewardEpochInfo.signingPolicy.startVotingRoundId;
  const endVotingRoundId = rewardEpochInfo.endVotingRoundId;
  if (startVotingRoundId === undefined || endVotingRoundId === undefined) {
    throw new Error("Start or end voting round id is undefined");
  }
  // Calculate total amount of rewards for the reward epoch
  let totalAmount = rewardEpochInfo.fuInflationRewardsOffered.amount;

  for (const incentiveOffered of rewardEpochInfo.fuIncentivesOffered) {
    totalAmount += incentiveOffered.offerAmount;
  }

  if (process.env.TEST_FU_INFLATION_REWARD_AMOUNT) {
    totalAmount = BigInt(process.env.TEST_FU_INFLATION_REWARD_AMOUNT);
  }
  // Create a map of votingRoundId -> feedId -> rewardOffer
  const rewardOfferMap = new Map<number, Map<string, IFUPartialRewardOfferForRound[]>>();
  const numberOfVotingRounds = endVotingRoundId - startVotingRoundId + 1;
  const sharePerOne: bigint = totalAmount / BigInt(numberOfVotingRounds);
  const remainder: number = Number(totalAmount % BigInt(numberOfVotingRounds));

  for (let votingRoundId = startVotingRoundId; votingRoundId <= endVotingRoundId; votingRoundId++) {
    let undistributedVotingRoundAmount = sharePerOne + (votingRoundId - startVotingRoundId < remainder ? 1n : 0n);
    let totalUndistributedShares = rewardEpochInfo.fuInflationRewardsOffered.feedConfigurations.reduce(
      (acc, feed) => acc + BigInt(feed.inflationShare),
      0n
    );
    for (const configuration of rewardEpochInfo.fuInflationRewardsOffered.feedConfigurations) {
      const amount = (undistributedVotingRoundAmount * BigInt(configuration.inflationShare)) / totalUndistributedShares;
      undistributedVotingRoundAmount -= amount;
      totalUndistributedShares -= BigInt(configuration.inflationShare);
      const feedOfferForVoting: IFUPartialRewardOfferForRound = {
        votingRoundId,
        amount,
        feedId: configuration.feedId,
        rewardBandValue: configuration.rewardBandValue,
      };
      const feedOffers = rewardOfferMap.get(votingRoundId) || new Map<string, IFUPartialRewardOfferForRound[]>();
      rewardOfferMap.set(votingRoundId, feedOffers);
      const feedIdOffers = feedOffers.get(configuration.feedId) || [];
      feedOffers.set(configuration.feedId, feedIdOffers);
      feedIdOffers.push(feedOfferForVoting);
    }
  }
  return rewardOfferMap;
}
