import { BURN_ADDRESS, FTSO2_FAST_UPDATES_PROTOCOL_ID } from "../configs/networks";
import { FUFeedValue } from "../data-calculation-interfaces";
import { FastUpdateFeedConfiguration } from "../events/FUInflationRewardsOffered";
import { IFUPartialRewardOfferForRound } from "../utils/PartialRewardOffer";
import { ClaimType, IPartialRewardClaim } from "../utils/RewardClaim";
import { Address, MedianCalculationResult } from "../voting-types";
import { RewardTypePrefix } from "./RewardTypePrefix";

const TOTAL_PPM = 1000000n;

export enum FastUpdatesRewardClaimType {
  NO_SUBMISSIONS = "no submissions",
  NO_MEDIAN_PRICE = "no median price",
  MISSED_BAND = "missed band",
  FEE = "fee",
  PARTICIPATION = "participation",
}

/**
 * Calculates the reward claims for the fast updates protocol based on
 * accuracy of the feed value compared to the median value.
 * The median value for the voting round id N is compared to the event
 * emitted feed value at the beginning of the voting epoch N.
 * The rewards are paid out only if the feed value is within the specific 
 * reward band around the median value.
 */
export function calculateFastUpdatesClaims(
  offer: IFUPartialRewardOfferForRound,
  medianResult: MedianCalculationResult,
  feedValue: FUFeedValue,
  feedConfiguration: FastUpdateFeedConfiguration,
  signingPolicyAddressesSubmitted: Address[],
  signingAddressToDelegationAddress: Map<Address, Address>,
  signingAddressToIdentityAddress: Map<Address, Address>,
  signingAddressToFeeBips: Map<Address, number>
): IPartialRewardClaim[] {
  if (signingPolicyAddressesSubmitted.length === 0 || medianResult.data.finalMedian.isEmpty) {
    const backClaim: IPartialRewardClaim = {
      votingRoundId: offer.votingRoundId,
      beneficiary: BURN_ADDRESS,
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
      offerIndex: 0,
      feedId: offer.feedId,
      protocolTag: "" + FTSO2_FAST_UPDATES_PROTOCOL_ID,
      rewardTypeTag: RewardTypePrefix.FAST_UPDATES_ACCURACY,
      rewardDetailTag:
        signingPolicyAddressesSubmitted.length === 0
          ? FastUpdatesRewardClaimType.NO_SUBMISSIONS
          : FastUpdatesRewardClaimType.NO_MEDIAN_PRICE,
    };
    return [backClaim];
  }

  const allRewardClaims: IPartialRewardClaim[] = [];
  let medianValue: bigint = BigInt(medianResult.data.finalMedian.value);
  let fastUpdatesValue: bigint = feedValue.value;
  const fuDecimals = BigInt(feedValue.decimals);
  const medianDecimals = BigInt(medianResult.data.finalMedian.decimals);
  if (fuDecimals > medianDecimals) {
    medianValue *= BigInt(10n ** (fuDecimals - medianDecimals));
  } else if (fuDecimals < medianDecimals) {
    fastUpdatesValue *= BigInt(10n ** (medianDecimals - fuDecimals));
  }
  const delta = (medianValue * BigInt(feedConfiguration.rewardBandValue)) / TOTAL_PPM;
  if (fastUpdatesValue < medianValue - delta || fastUpdatesValue > medianValue + delta) {
    const backClaim: IPartialRewardClaim = {
      votingRoundId: offer.votingRoundId,
      beneficiary: BURN_ADDRESS,
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
      offerIndex: 0,
      feedId: offer.feedId,
      protocolTag: "" + FTSO2_FAST_UPDATES_PROTOCOL_ID,
      rewardTypeTag: RewardTypePrefix.FAST_UPDATES_ACCURACY,
      rewardDetailTag: FastUpdatesRewardClaimType.MISSED_BAND,
    };
    return [backClaim];
  }
  const numberOfSubmissions = BigInt(signingPolicyAddressesSubmitted.length);
  const sharePerOne = offer.amount / numberOfSubmissions;
  const remainder = offer.amount % numberOfSubmissions;
  for (let i = 0; i < numberOfSubmissions; i++) {
    const signingAddress = signingPolicyAddressesSubmitted[i];
    const delegationAddress = signingAddressToDelegationAddress.get(signingAddress);
    const feeBIPS = signingAddressToFeeBips.get(signingAddress);
    const identityAddress = signingAddressToIdentityAddress.get(signingAddress);
    if (!signingAddress || !delegationAddress || !identityAddress) {
      throw new Error(
        "Critical error: signingAddress, delegationAddress or identityAddress is not available. This should never happen."
      );
    }
    if (feeBIPS === undefined) {
      throw new Error(
        `Critical error: feeBIPS is not available for signing address ${signingAddress}. This should never happen.`
      );
    }
    const voterAmount = sharePerOne + (i < remainder ? 1n : 0n);
    const feeAmount = (voterAmount * BigInt(feeBIPS)) / TOTAL_PPM;
    const feeClaim: IPartialRewardClaim = {
      votingRoundId: offer.votingRoundId,
      beneficiary: identityAddress,
      amount: feeAmount,
      claimType: ClaimType.FEE,
      offerIndex: 0,
      feedId: offer.feedId,
      protocolTag: "" + FTSO2_FAST_UPDATES_PROTOCOL_ID,
      rewardTypeTag: RewardTypePrefix.FAST_UPDATES_ACCURACY,
      rewardDetailTag: FastUpdatesRewardClaimType.FEE,
    };
    const participationClaim: IPartialRewardClaim = {
      votingRoundId: offer.votingRoundId,
      beneficiary: delegationAddress,
      amount: voterAmount - feeAmount,
      claimType: ClaimType.WNAT,
      offerIndex: 0,
      feedId: offer.feedId,
      protocolTag: "" + FTSO2_FAST_UPDATES_PROTOCOL_ID,
      rewardTypeTag: RewardTypePrefix.FAST_UPDATES_ACCURACY,
      rewardDetailTag: FastUpdatesRewardClaimType.PARTICIPATION,
    };
    allRewardClaims.push(feeClaim);
    allRewardClaims.push(participationClaim);
  }
  return allRewardClaims;
}
