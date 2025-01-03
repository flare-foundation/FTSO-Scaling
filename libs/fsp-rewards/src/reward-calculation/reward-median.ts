import { encodeParameters } from "web3-eth-abi";
import { soliditySha3 } from "web3-utils";
import { VoterWeights } from "../../../ftso-core/src/RewardEpoch";
import { FTSO2_PROTOCOL_ID } from "../../../ftso-core/src/constants";
import { IPartialRewardOfferForRound } from "../utils/PartialRewardOffer";
import { ClaimType, IPartialRewardClaim } from "../utils/RewardClaim";
import { Address, MedianCalculationResult } from "../../../ftso-core/src/voting-types";
import { RewardTypePrefix } from "./RewardTypePrefix";
import { medianRewardDistributionWeight } from "./reward-utils";
import {TOTAL_BIPS, TOTAL_PPM} from "../constants";

export enum MediantRewardClaimType {
  LOW_TURNOUT_CLAIM_BACK = "LOW_TURNOUT_CLAIM_BACK",
  NO_NORMALIZED_WEIGHT = "NO_NORMALIZED_WEIGHT",
  FEE = "FEE",
  PARTICIPATION = "PARTICIPATION",
}

/**
 * Given a partial reward offer, median calculation result for a specific feed and voter weights it calculates the median closeness partial
 * reward claims for the offer for all voters (with non-zero reward). For each voter all relevant partial claims are generated (including fees, participation rewards, etc).
 * @param votersWeights map from submitAddress to VoterWeights
 */
export function calculateMedianRewardClaims(
  offer: IPartialRewardOfferForRound,
  calculationResult: MedianCalculationResult,
  votersWeights: Map<Address, VoterWeights>
): IPartialRewardClaim[] {
  interface VoterRewarding {
    readonly submitAddress: Address;
    weight: bigint;
    readonly pct: boolean; // gets PCT (percent) reward (secondary band)
    readonly iqr: boolean; // gets IQR (inter quartile range) reward (primary band)
  }

  ///////// Helper functions /////////

  /**
   * Randomization for border cases
   *  a random for IQR belt is calculated from hash(votingRoundId, slotId, address)
   */
  function randomSelect(feedId: string, votingRoundId: number, voterAddress: Address): boolean {
    const prefixedFeedId = feedId.startsWith("0x") ? feedId : "0x" + feedId;
    return (
      BigInt(
        soliditySha3(encodeParameters(["bytes", "uint256", "address"], [prefixedFeedId, votingRoundId, voterAddress]))!
      ) %
        2n ===
      1n
    );
  }

  // sanity check
  if (offer.votingRoundId === undefined) {
    throw new Error("Critical: voting round must be defined.");
  }
  const votingRoundId = offer.votingRoundId;
  if (calculationResult.votingRoundId !== votingRoundId) {
    throw new Error("Critical: Calculation result voting round id does not match the offer voting round id");
  }

  // Turnout condition is not reached or no median is computed. Offer is returned to the provider.
  if (
    calculationResult.data.participatingWeight * TOTAL_BIPS <
      calculationResult.totalVotingWeight * BigInt(offer.minRewardedTurnoutBIPS) ||
    calculationResult.data.finalMedian.isEmpty
  ) {
    const backClaim: IPartialRewardClaim = {
      votingRoundId,
      beneficiary: offer.claimBackAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
      offerIndex: offer.offerIndex,
      feedId: offer.feedId,
      protocolTag: "" + FTSO2_PROTOCOL_ID,
      rewardTypeTag: RewardTypePrefix.MEDIAN,
      rewardDetailTag: MediantRewardClaimType.LOW_TURNOUT_CLAIM_BACK,
    };
    return [backClaim];
  }

  // Use bigint for proper integer division
  const median = BigInt(calculationResult.data.finalMedian.value);

  // sanity check - establish boundaries
  if (calculationResult.data.quartile1.isEmpty || calculationResult.data.quartile3.isEmpty) {
    throw new Error("Critical error: quartile values are not available. This should never happen.");
  }

  const lowIQR = BigInt(calculationResult.data.quartile1.value);
  const highIQR = BigInt(calculationResult.data.quartile3.value);

  const voterRecords: VoterRewarding[] = [];

  const abs = n => (n < 0n ? -n : n);
  const secondaryBandDiff = (abs(median) * BigInt(offer.secondaryBandWidthPPM)) / TOTAL_PPM;

  const lowPCT = median - secondaryBandDiff;
  const highPCT = median + secondaryBandDiff;

  // assemble voter records
  for (let i = 0; i < calculationResult.votersSubmitAddresses!.length; i++) {
    const submitAddress = calculationResult.votersSubmitAddresses![i];
    const feedValue = calculationResult.feedValues![i];
    if (feedValue.isEmpty) {
      continue;
    }
    const value = BigInt(feedValue.value);
    const record: VoterRewarding = {
      submitAddress: submitAddress,
      weight: medianRewardDistributionWeight(votersWeights.get(submitAddress)!),
      iqr:
        (value > lowIQR && value < highIQR) ||
        ((value === lowIQR || value === highIQR) && randomSelect(offer.feedId, votingRoundId, submitAddress)),
      pct: value > lowPCT && value < highPCT,
    };

    voterRecords.push(record);
  }

  // calculate the weight eligible for iqr reward and the weight for pct reward
  let iqrSum = 0n;
  let pctSum = 0n;
  for (const voterRecord of voterRecords) {
    if (voterRecord.iqr) {
      iqrSum += voterRecord.weight;
    }
    if (voterRecord.pct) {
      pctSum += voterRecord.weight;
    }
  }

  // calculate total normalized rewarded weight
  let totalNormalizedRewardedWeight = 0n;
  for (const voterRecord of voterRecords) {
    let newWeight = 0n;
    if (pctSum === 0n) {
      if (voterRecord.iqr) {
        newWeight = voterRecord.weight;
      }
    } else {
      if (voterRecord.iqr) {
        newWeight += BigInt(offer.primaryBandRewardSharePPM) * voterRecord.weight * pctSum;
      }
      if (voterRecord.pct) {
        newWeight += (TOTAL_PPM - BigInt(offer.primaryBandRewardSharePPM)) * voterRecord.weight * iqrSum;
      }
    }
    voterRecord.weight = newWeight; // correct the weight according to the normalization
    totalNormalizedRewardedWeight += newWeight;
  }

  if (totalNormalizedRewardedWeight === 0n) {
    // claim back to reward issuer
    const backClaim: IPartialRewardClaim = {
      votingRoundId,
      beneficiary: offer.claimBackAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
      offerIndex: offer.offerIndex,
      feedId: offer.feedId,
      protocolTag: "" + FTSO2_PROTOCOL_ID,
      rewardTypeTag: RewardTypePrefix.MEDIAN,
      rewardDetailTag: MediantRewardClaimType.NO_NORMALIZED_WEIGHT,
    };
    return [backClaim];
  }

  const rewardClaims: IPartialRewardClaim[] = [];
  let totalReward = 0n;
  let availableReward = offer.amount;
  let availableWeight = totalNormalizedRewardedWeight;

  for (const voterRecord of voterRecords) {
    // double declining balance
    if (voterRecord.weight === 0n) {
      continue;
    }
    let reward = 0n;
    if (voterRecord.weight > 0n) {
      // sanity check
      if (availableWeight === 0n) {
        throw new Error("Critical: reward-median: availableWeight must be non-zero");
      }
      reward = (voterRecord.weight * availableReward) / availableWeight;
    }
    availableReward = availableReward - reward;
    availableWeight = availableWeight - voterRecord.weight;

    totalReward += reward;

    const rewardClaim = generateMedianRewardClaimsForVoter(
      reward,
      offer,
      votersWeights.get(voterRecord.submitAddress)!
    );
    rewardClaims.push(...rewardClaim);
  }
  // Assert
  if (totalReward !== offer.amount) {
    throw new Error(`Total reward for ${offer.feedId} is not equal to the offer amount`);
  }

  return rewardClaims;
}

/**
 * Given assigned reward it generates reward claims for the voter.
 * Currently only a partial fee claim and capped wnat delegation participation weight claims are created.
 */
function generateMedianRewardClaimsForVoter(
  amount: bigint,
  offer: IPartialRewardOfferForRound,
  voterWeights: VoterWeights
) {
  const result: IPartialRewardClaim[] = [];
  const fee = (amount * BigInt(voterWeights.feeBIPS)) / TOTAL_BIPS;

  const participationReward = amount - fee;

  // No claims with zero amount
  if (fee > 0n) {
    const feeClaim: IPartialRewardClaim = {
      votingRoundId: offer.votingRoundId,
      beneficiary: voterWeights.identityAddress.toLowerCase(),
      amount: fee,
      claimType: ClaimType.FEE,
      offerIndex: offer.offerIndex,
      feedId: offer.feedId,
      protocolTag: "" + FTSO2_PROTOCOL_ID,
      rewardTypeTag: RewardTypePrefix.MEDIAN,
      rewardDetailTag: MediantRewardClaimType.FEE,
    };
    result.push(feeClaim);
  }
  if (participationReward > 0n) {
    const rewardClaim: IPartialRewardClaim = {
      votingRoundId: offer.votingRoundId,
      beneficiary: voterWeights.delegationAddress.toLowerCase(),
      amount: participationReward,
      claimType: ClaimType.WNAT,
      offerIndex: offer.offerIndex,
      feedId: offer.feedId,
      protocolTag: "" + FTSO2_PROTOCOL_ID,
      rewardTypeTag: RewardTypePrefix.MEDIAN,
      rewardDetailTag: MediantRewardClaimType.PARTICIPATION,
    };
    result.push(rewardClaim);
  }
  return result;
}
