import { encodeParameters } from "web3-eth-abi";
import { soliditySha3 } from "web3-utils";
import { VoterWeights } from "../RewardEpoch";
import { ClaimType, IPartialRewardClaim } from "../utils/RewardClaim";
import { Address, MedianCalculationResult } from "../voting-types";
import { medianRewardDistributionWeight } from "./reward-utils";
import { TOTAL_BIPS, TOTAL_PPM } from "../configs/networks";
import { RewardTypePrefix } from "./RewardTypePrefix";
import { IPartialRewardOfferForRound } from "../utils/PartialRewardOffer";

/**
 * Given a partial reward offer, median calculation result for a specific feed and voter weights it calculates the median closeness partial
 * reward claims for the offer for all voters (with non-zero reward). For each voter all relevant partial claims are generated (including fees, participation rewards, etc).
 * @param offer
 * @param calculationResult
 * @param votersWeights map from submitAddress to VoterWeights
 * @param addLog
 * @returns
 */
export function calculateMedianRewardClaims(
  offer: IPartialRewardOfferForRound,
  calculationResult: MedianCalculationResult,
  votersWeights: Map<Address, VoterWeights>,
  addLog = false
): IPartialRewardClaim[] {
  interface VoterRewarding {
    readonly submitAddress: Address;
    weight: bigint;
    readonly pct: boolean; // gets PCT (percent) reward (secondary band)
    readonly iqr: boolean; // gets IQR (inter quartile range) reward (primary band)
  }

  ///////// Helper functions /////////

  function addInfo(text: string) {
    return addLog
      ? {
          info: `${RewardTypePrefix.MEDIAN}: ${text}`,
          votingRoundId,
        }
      : {};
  }

  /**
   * Randomization for border cases
   *  a random for IQR belt is calculated from hash(priceEpochId, slotId, address)
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
    calculationResult.data.finalMedianPrice.isEmpty
  ) {
    const backClaim: IPartialRewardClaim = {
      beneficiary: offer.claimBackAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
      ...addInfo("low turnout claim back"),
    };
    return [backClaim];
  }

  // Use bigint for proper integer division
  const medianPrice = BigInt(calculationResult.data.finalMedianPrice.value);

  // sanity check - establish boundaries
  if (calculationResult.data.quartile1Price.isEmpty || calculationResult.data.quartile3Price.isEmpty) {
    throw new Error("Critical error: quartile prices are not available. This should never happen.");
  }

  const lowIQR = BigInt(calculationResult.data.quartile1Price.value);
  const highIQR = BigInt(calculationResult.data.quartile3Price.value);

  const voterRecords: VoterRewarding[] = [];

  const abs = n => (n < 0n ? -n : n);
  const secondaryBandDiff = (abs(medianPrice) * BigInt(offer.secondaryBandWidthPPM)) / TOTAL_PPM;

  const lowPCT = medianPrice - secondaryBandDiff;
  const highPCT = medianPrice + secondaryBandDiff;

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
      beneficiary: offer.claimBackAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
      ...addInfo("no normalized weight"),
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
      offer.votingRoundId,
      votersWeights.get(voterRecord.submitAddress)!,
      addLog
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
  votingRoundId: number,
  voterWeights: VoterWeights,
  addLog = false
) {
  function addInfo(text: string) {
    return addLog
      ? {
          info: `${RewardTypePrefix.MEDIAN}: ${text}`,
          votingRoundId,
        }
      : {};
  }

  const result: IPartialRewardClaim[] = [];
  const fee = (amount * BigInt(voterWeights.feeBIPS)) / TOTAL_BIPS;

  const participationReward = amount - fee;

  // No claims with zero amount
  if (fee > 0n) {
    const feeClaim: IPartialRewardClaim = {
      beneficiary: voterWeights.identityAddress.toLowerCase(),
      amount: fee,
      claimType: ClaimType.FEE,
      ...addInfo("fee"),
    };
    result.push(feeClaim);
  }
  if (participationReward > 0n) {
    const rewardClaim: IPartialRewardClaim = {
      beneficiary: voterWeights.delegationAddress.toLowerCase(),
      amount: participationReward,
      claimType: ClaimType.WNAT,
      ...addInfo("participation"),
    };
    result.push(rewardClaim);
  }
  return result;
}
