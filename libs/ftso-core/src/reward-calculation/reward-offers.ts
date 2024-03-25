import { FINALIZATION_BIPS, SIGNING_BIPS, TOTAL_BIPS } from "../configs/networks";
import { InflationRewardsOffered, RewardOffers } from "../events";
import {
  IPartialRewardOfferForEpoch,
  IPartialRewardOfferForRound,
  PartialRewardOffer,
} from "../utils/PartialRewardOffer";

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

/**
 * Given all reward offers for reward epoch it splits them into partial reward offers for voting rounds and feeds.
 * First inflation reward offers are used to generate partial reward offers for feeds.
 * Then each reward offer is split to partial reward offers for each voting round.
 * A map: votingRoundId => feedId => partialRewardOffer[] is returned containing all partial reward offers.
 */
export function granulatedPartialOfferMap(
  startVotingRoundId: number,
  endVotingRoundId: number,
  rewardOffers: RewardOffers
): Map<number, Map<string, IPartialRewardOfferForRound[]>> {
  const rewardOfferMap = new Map<number, Map<string, IPartialRewardOfferForRound[]>>();
  const allRewardOffers = rewardOffers.rewardOffers.map(rewardOffer =>
    PartialRewardOffer.fromRewardOffered(rewardOffer)
  );
  for (const inflationRewardOffer of rewardOffers.inflationOffers) {
    allRewardOffers.push(...PartialRewardOffer.fromInflationRewardOfferedEquallyDistributed(inflationRewardOffer));
  }
  for (const rewardOffer of allRewardOffers) {
    const votingEpochRewardOffers = PartialRewardOffer.splitToVotingRoundsEqually(
      startVotingRoundId,
      endVotingRoundId,
      rewardOffer
    );
    for (const votingEpochRewardOffer of votingEpochRewardOffers) {
      const votingRoundId = votingEpochRewardOffer.votingRoundId!;
      const feedId = votingEpochRewardOffer.feedId;
      const feedOffers = rewardOfferMap.get(votingRoundId) || new Map<string, IPartialRewardOfferForRound[]>();
      rewardOfferMap.set(votingRoundId, feedOffers);
      const feedIdOffers = feedOffers.get(feedId) || [];
      feedOffers.set(feedId, feedIdOffers);
      feedIdOffers.push(votingEpochRewardOffer);
    }
  }
  return rewardOfferMap;
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
