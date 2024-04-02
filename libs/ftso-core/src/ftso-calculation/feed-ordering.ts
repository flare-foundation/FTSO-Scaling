import { RewardOffers } from "../events";
import { Feed } from "../voting-types";

/**
 * Data for single feed with reward information (for inflation or community reward).
 */
export interface FeedWithTypeAndValue extends Feed {
  flrValue: bigint;
  isInflation: boolean;
}

/**
 * Calculates a deterministic sequence of feeds based on the provided offers for a reward epoch.
 * The sequence is sorted by the value of the feed in the reward epoch in decreasing order.
 * In case of equal values the feedId is used to sort in increasing order.
 * The sequence defines positions of the feeds in the value vectors for the reward epoch.
 */
export function rewardEpochFeedSequence(rewardOffers: RewardOffers): Feed[] {
  const feedValues = new Map<string, FeedWithTypeAndValue>();

  for (const inflationOffer of rewardOffers.inflationOffers) {
    for (let i = 0; i < inflationOffer.feedIds.length; i++) {
      const feedId = inflationOffer.feedIds[i].toLowerCase();
      let feedValueType = feedValues.get(feedId);
      if (feedValueType === undefined) {
        feedValueType = {
          id: feedId,
          decimals: inflationOffer.decimals[i],
          isInflation: true,
          flrValue: 0n, // irrelevant for inflation offers
        };
        feedValues.set(feedValueType.id, feedValueType);
      }
    }
  }

  for (const communityOffer of rewardOffers.rewardOffers) {
    const feedId = communityOffer.feedId.toLowerCase();
    let feedValueType = feedValues.get(feedId);
    if (feedValueType === undefined) {
      feedValueType = {
        id: communityOffer.feedId.toLowerCase(),
        decimals: communityOffer.decimals,
        isInflation: false,
        flrValue: 0n,
      };
      feedValues.set(feedValueType.id, feedValueType);
    }
    feedValueType.flrValue += feedValueType.flrValue + communityOffer.amount;
  }

  const feedSequence = sortFeedWithValuesToCanonicalOrder(Array.from(feedValues.values()));

  return feedSequence.map(feedValueType => {
    return {
      id: feedValueType.id,
      decimals: feedValueType.decimals,
    };
  });
}

/**
 * Sort feeds in canonical order.
 * Inflation feeds are first, sorted by feed name.
 * Then non-inflation feeds are sorted by decreasing value and on same value by feed name.
 */
export function sortFeedWithValuesToCanonicalOrder(feeds: FeedWithTypeAndValue[]): FeedWithTypeAndValue[] {
  feeds.sort((a, b) => {
    if (a.isInflation && !b.isInflation) {
      return -1;
    }
    if (!a.isInflation && b.isInflation) {
      return 1;
    }
    if (a.isInflation && b.isInflation) {
      if (a.id < b.id) {
        return -1;
      }
      if (a.id > b.id) {
        return 1;
      }
      return 0; // should not happen
    }
    // None is from inflation.
    // Sort decreasing by value and on same value increasing by feedId
    if (a.flrValue > b.flrValue) {
      return -1;
    }
    if (a.flrValue < b.flrValue) {
      return 1;
    }
    // values are same, sort lexicographically
    if (a.id < b.id) {
      return -1;
    }
    if (a.id > b.id) {
      return 1;
    }
    return 0; // Should not happen, Offers for same feed should be merged
  });
  return feeds;
}
