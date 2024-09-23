import { BURN_ADDRESS } from "../configs/networks";
import { InflationRewardsOffered, RewardsOffered } from "../events";
import { Address } from "../voting-types";

export interface IPartialRewardOfferForEpoch {
  // reward epoch id
  rewardEpochId: number;
  // hex encoded feed id
  feedId: string;
  // number of decimals (negative exponent)
  decimals: number;
  // amount (in wei) of reward in native coin
  amount: bigint;
  // minimal reward eligibility turnout threshold in BIPS (basis points)
  minRewardedTurnoutBIPS: number;
  // primary band reward share in PPM (parts per million)
  primaryBandRewardSharePPM: number;
  // secondary band width in PPM (parts per million) in relation to the median
  secondaryBandWidthPPM: number;
  // address that can claim undistributed part of the reward (or burn address)
  claimBackAddress: Address;
  // indicates if the reward is from inflation
  isInflation: boolean;
  // Reward offer index - link to the initial reward offer
  offerIndex: number;
}

export interface IPartialRewardOfferForRound extends IPartialRewardOfferForEpoch {
  // voting round id
  votingRoundId: number;
  shouldBeBurned?: boolean;
}

export interface IFUPartialRewardOfferForRound {
  votingRoundId: number;
  feedId: string;
  amount: bigint;
  rewardBandValue: number;
  shouldBeBurned?: boolean;
}

export interface IFDCPartialRewardOfferForRound {
  votingRoundId: number;
  amount: bigint;
  shouldBeBurned?: boolean;
}


export namespace PartialRewardOffer {
  export function fromRewardOffered(rewardOffer: RewardsOffered): IPartialRewardOfferForEpoch {
    return {
      rewardEpochId: rewardOffer.rewardEpochId,
      feedId: rewardOffer.feedId.startsWith("0x") ? rewardOffer.feedId : "0x" + rewardOffer.feedId,
      decimals: rewardOffer.decimals,
      amount: rewardOffer.amount,
      minRewardedTurnoutBIPS: rewardOffer.minRewardedTurnoutBIPS,
      primaryBandRewardSharePPM: rewardOffer.primaryBandRewardSharePPM,
      secondaryBandWidthPPM: rewardOffer.secondaryBandWidthPPM,
      claimBackAddress: rewardOffer.claimBackAddress,
      isInflation: false,
      offerIndex: rewardOffer.offerIndex!,
    };
  }

  /**
   * From a given inflation reward offer it creates multiple reward offers with the
   * same parameters but different feed names and equally distributed amount.
   * @param inflationRewardOffer
   */
  export function fromInflationRewardOfferedEquallyDistributed(
    inflationRewardOffer: InflationRewardsOffered
  ): IPartialRewardOfferForEpoch[] {
    const rewardOffers: IPartialRewardOfferForEpoch[] = [];
    const sharePerOne: bigint = inflationRewardOffer.amount / BigInt(inflationRewardOffer.feedIds.length);
    const remainder: bigint = inflationRewardOffer.amount % BigInt(inflationRewardOffer.feedIds.length);
    for (let i = 0; i < inflationRewardOffer.feedIds.length; i++) {
      rewardOffers.push({
        rewardEpochId: inflationRewardOffer.rewardEpochId,
        feedId: inflationRewardOffer.feedIds[i],
        decimals: inflationRewardOffer.decimals[i],
        amount: sharePerOne + (i < remainder ? 1n : 0n),
        minRewardedTurnoutBIPS: inflationRewardOffer.minRewardedTurnoutBIPS,
        primaryBandRewardSharePPM: inflationRewardOffer.primaryBandRewardSharePPM,
        secondaryBandWidthPPM: inflationRewardOffer.secondaryBandWidthPPMs[i],
        claimBackAddress: BURN_ADDRESS,
        isInflation: true,
        offerIndex: inflationRewardOffer.offerIndex!,
      });
    }
    return rewardOffers;
  }
}
