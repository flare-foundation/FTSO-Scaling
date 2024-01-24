import { InflationRewardsOffered, RewardOffers } from "../events";
import { IPartialRewardOffer, PartialRewardOffer } from "../utils/PartialRewardOffer";
import { SIGNING_BIPS, TOTAL_BIPS, FINALIZATION_BIPS } from "./reward-constants";

/**
 * A split of partial reward offer into three parts:
 */
export interface SplitRewardOffer {
  readonly medianRewardOffer: IPartialRewardOffer;
  readonly signingRewardOffer: IPartialRewardOffer;
  readonly finalizationRewardOffer: IPartialRewardOffer;
}

/**
 * Creates partial reward offers for feeds from inflation reward offer.
 * Currently only equally distributed inflation reward offers are supported (mode === 0)
 * @param inflationRewardOffer 
 * @returns 
 */
export function distributeInflationRewardOfferToFeeds(inflationRewardOffer: InflationRewardsOffered): IPartialRewardOffer[] {
  if (inflationRewardOffer.mode === 0) {
    return PartialRewardOffer.fromInflationRewardOfferedEquallyDistributed(inflationRewardOffer);
  }
  throw new Error(`Mode ${inflationRewardOffer.mode} is not supported`);
}

/**
 * Given all reward offers for reward epoch it splits them into partial reward offers for voting rounds and feeds.
 * First inflation reward offers are used to generate partial reward offers for feeds.
 * Then each reward offer is split to partial reward offers for each voting round.
 * A map: votingRoundId => feedName => partialRewardOffer[] is returned containing all partial reward offers.
 * @param startVotingRoundId
 * @param endVotingRoundId
 * @param rewardOffers
 * @returns
 */
export function granulatedPartialOfferMap(
  startVotingRoundId: number,
  endVotingRoundId,
  rewardOffers: RewardOffers
): Map<number, Map<string, IPartialRewardOffer[]>> {
  const rewardOfferMap = new Map<number, Map<string, IPartialRewardOffer[]>>();
  const allRewardOffers = rewardOffers.rewardOffers.map(rewardOffer => PartialRewardOffer.fromRewardOffered(rewardOffer));
  for (const inflationRewardOffer of rewardOffers.inflationOffers) {
    allRewardOffers.push(...PartialRewardOffer.fromInflationRewardOfferedEquallyDistributed(inflationRewardOffer));
  }
  for (const rewardOffer of allRewardOffers) {
    const votingEpochRewardOffers = PartialRewardOffer.splitToVotingRoundsEqually(
      startVotingRoundId, endVotingRoundId,
      rewardOffer
    );
    for (const votingEpochRewardOffer of votingEpochRewardOffers) {
      const votingRoundId = votingEpochRewardOffer.votingRoundId!;
      const feedName = votingEpochRewardOffer.feedName;
      const feedOffers = rewardOfferMap.get(votingRoundId) || new Map<string, IPartialRewardOffer[]>();
      rewardOfferMap.set(votingRoundId, feedOffers);
      const feedNameOffers = feedOffers.get(feedName) || [];
      feedOffers.set(feedName, feedNameOffers);
      feedNameOffers.push(votingEpochRewardOffer);
    }
  }
  return rewardOfferMap;
}


/**
 * Splits a partial reward offer into three parts: median, signing and finalization.
 * These split offers are used as inputs into reward calculation for specific types 
 * of rewards.
 * @param offer 
 * @returns 
 */
export function splitRewardOfferByTypes(offer: IPartialRewardOffer): SplitRewardOffer {
  const forSigning = (offer.amount * SIGNING_BIPS) / TOTAL_BIPS;
  const forFinalization = (offer.amount * FINALIZATION_BIPS) / TOTAL_BIPS;
  const forMedian = offer.amount - forSigning - forFinalization;
  const result: SplitRewardOffer = {
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
    }
  };
  return result;
}
