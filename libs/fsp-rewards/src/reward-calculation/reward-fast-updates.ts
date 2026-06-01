import { FastUpdateFeedConfiguration } from "../../../contracts/src/events/FUInflationRewardsOffered";
import { ILogger } from "../../../ftso-core/src/utils/ILogger";
import { VoterWeights } from "../../../ftso-core/src/RewardEpoch";
import { isFip16Active } from "../../../ftso-core/src/constants";
import { Address, MedianCalculationResult } from "../../../ftso-core/src/voting-types";
import { BURN_ADDRESS, FTSO2_FAST_UPDATES_PROTOCOL_ID, TOTAL_BIPS } from "../constants";
import { FUFeedValue } from "../data-calculation-interfaces";
import { IFUPartialRewardOfferForRound, IPartialRewardOfferForRound } from "../utils/PartialRewardOffer";
import { ClaimType, IPartialRewardClaim } from "../utils/RewardClaim";
import { RewardTypePrefix } from "./RewardTypePrefix";
import { generateSigningWeightBasedClaimsForVoter } from "./reward-signing-split";

const TOTAL_PPM = 1000000n;

export enum FastUpdatesRewardClaimType {
  NO_SUBMISSIONS = "NO_SUBMISSIONS",
  NO_MEDIAN_PRICE = "NO_MEDIAN_PRICE",
  MISSED_BAND = "MISSING_BAND",
  FEE = "FEE",
  PARTICIPATION = "PARTICIPATION",
  MISSING_FAST_UPDATE_FEEDS = "MISSING_FAST_UPDATE_FEEDS",
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
  signingAddressToFeeBips: Map<Address, number>,
  signingAddressToVoterWeights: Map<Address, VoterWeights>,
  rewardEpochId: number,
  logger: ILogger
): IPartialRewardClaim[] {
  if (offer.shouldBeBurned) {
    const fullOfferBackClaim: IPartialRewardClaim = {
      votingRoundId: offer.votingRoundId,
      beneficiary: BURN_ADDRESS,
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
      offerIndex: 0,
      // feedId: offer.feedId,  // should be undefined
      protocolTag: "" + FTSO2_FAST_UPDATES_PROTOCOL_ID,
      rewardTypeTag: RewardTypePrefix.FULL_OFFER_CLAIM_BACK,
      rewardDetailTag: "", // no additional tag
    };
    return [fullOfferBackClaim];
  }

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
    let signingAddress = signingPolicyAddressesSubmitted[i];
    let delegationAddress = signingAddressToDelegationAddress.get(signingAddress);
    let feeBIPS = signingAddressToFeeBips.get(signingAddress);
    let identityAddress = signingAddressToIdentityAddress.get(signingAddress);
    if (!signingAddress || !delegationAddress || !identityAddress) {
      if (process.env.ALLOW_IDENTITY_ADDRESS_SIGNING) {
        const identityAddressToSigningAddress = new Map<Address, Address>();
        signingAddressToIdentityAddress.forEach((value, key) => {
          identityAddressToSigningAddress.set(value, key);
        });
        if (!identityAddressToSigningAddress.has(signingAddress)) {
          throw new Error(
            `Critical error: with ALLOW_IDENTITY_ADDRESS_SIGNING enabled, not correct identityAddress (${signingAddress}). This should never happen.`
          );
        }
        identityAddress = signingAddress;
        signingAddress = identityAddressToSigningAddress.get(identityAddress);
        delegationAddress = signingAddressToDelegationAddress.get(signingAddress);
        feeBIPS = signingAddressToFeeBips.get(signingAddress);
        logger.error("----------------- IDENTITY SIGNING USED -----------------");
        logger.error("signingAddress: " + signingAddress);
      } else {
        throw new Error(
          `Critical error: signingAddress (${signingAddress}), delegationAddress (${delegationAddress}) or identityAddress (${identityAddress}) is not available. This should never happen.`
        );
      }
    }
    if (feeBIPS === undefined) {
      throw new Error(
        `Critical error: feeBIPS is not available for signing address ${signingAddress}. This should never happen.`
      );
    }
    const voterAmount = sharePerOne + (i < remainder ? 1n : 0n);

    // FIP.16: block-latency (fast updates) rewards are also split to stakers. The submitter earns an equal share per
    // submission (unchanged); that share is then split between delegators (WNAT) and stakers (MIRROR) in the ratio
    // cappedDelegation : 5*stake, exactly like signing/finalization/median. Before activation the share goes to fee +
    // WNAT (delegation) only. See `docs/migrations/FIP-16-signing-weight-unification.md`.
    if (isFip16Active(rewardEpochId)) {
      const voterWeights = signingAddressToVoterWeights.get(signingAddress);
      if (!voterWeights) {
        throw new Error(
          `Critical error: no voter weights for signing address ${signingAddress}. This should never happen.`
        );
      }
      const fuOffer: IPartialRewardOfferForRound = {
        votingRoundId: offer.votingRoundId,
        feedId: offer.feedId,
        amount: voterAmount,
        offerIndex: 0,
        claimBackAddress: BURN_ADDRESS,
      };
      allRewardClaims.push(
        ...generateSigningWeightBasedClaimsForVoter(
          voterAmount,
          fuOffer,
          voterWeights,
          RewardTypePrefix.FAST_UPDATES_ACCURACY,
          FTSO2_FAST_UPDATES_PROTOCOL_ID,
          rewardEpochId
        )
      );
      continue;
    }

    const feeAmount = (voterAmount * BigInt(feeBIPS)) / TOTAL_BIPS;
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
