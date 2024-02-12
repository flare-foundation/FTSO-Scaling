import { encodeParameters } from "web3-eth-abi";
import { soliditySha3 } from "web3-utils";
import { VoterWeights } from "../RewardEpoch";
import { IPartialRewardOffer } from "../utils/PartialRewardOffer";
import { ClaimType, IPartialRewardClaim } from "../utils/RewardClaim";
import { Address, MedianCalculationResult } from "../voting-types";
import { medianRewardDistributionWeight } from "./reward-utils";
import { TOTAL_BIPS, TOTAL_PPM } from "../configs/networks";

/**
 * Given a partial reward offer, median calculation result for a specific feed and voter weights it calculates the median closeness partial
 * reward claims for the offer for all voters (with non-zero reward). For each voter all relevant partial claims are generated (including fees, participation rewards, etc).
 */
export function calculateMedianRewardClaims(
  offer: IPartialRewardOffer,
  calculationResult: MedianCalculationResult,
  voterWeights: Map<Address, VoterWeights>
): IPartialRewardClaim[] {
  interface VoterRewarding {
    readonly voterAddress: string;
    weight: bigint;
    readonly pct: boolean; // gets PCT (percent) reward
    readonly iqr: boolean; // gets IQR (inter quartile range) reward
  }

  // sanity check
  if (offer.votingRoundId === undefined) {
    throw new Error("Critical: voting round must be defined.");
  }
  const votingRoundId = offer.votingRoundId;
  if (calculationResult.votingRoundId !== votingRoundId) {
    throw new Error("Critical: Calculation result voting round id does not match the offer voting round id");
  }

  // Randomization for border cases
  // - a random for IQR belt is calculated from hash(priceEpochId, slotId, address)
  function randomSelect(feedName: string, votingRoundId: number, voterAddress: Address): boolean {
    const prefixedFeedName = feedName.startsWith("0x") ? feedName : "0x" + feedName;
    return (
      BigInt(
        soliditySha3(
          encodeParameters(["bytes8", "uint256", "address"], [prefixedFeedName, votingRoundId, voterAddress])
        )!
      ) %
        2n ===
      1n
    );
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
  for (let i = 0; i < calculationResult.voters!.length; i++) {
    const voterAddress = calculationResult.voters![i];
    const feedValue = calculationResult.feedValues![i];
    if (feedValue.isEmpty) {
      continue;
    }
    const value = BigInt(feedValue.value);
    const record: VoterRewarding = {
      voterAddress,
      weight: medianRewardDistributionWeight(voterWeights.get(voterAddress)!),
      iqr:
        (value > lowIQR && value < highIQR) ||
        ((value === lowIQR || value === highIQR) && randomSelect(offer.feedName, votingRoundId, voterAddress)),
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
    const reward = (voterRecord.weight * availableReward) / availableWeight;
    availableReward = availableReward - reward;
    availableWeight = availableWeight - voterRecord.weight;

    totalReward += reward;

    const rewardClaim = generateMedianRewardClaimsForVoter(reward, voterWeights.get(voterRecord.voterAddress)!);
    rewardClaims.push(...rewardClaim);
  }
  // Assert
  if (totalReward !== offer.amount) {
    throw new Error(`Total reward for ${offer.feedName} is not equal to the offer amount`);
  }

  return rewardClaims;
}

/**
 * Given assigned reward it generates reward claims for the voter.
 * Currently only a partial fee claim and capped wnat delegation participation weight claims are created.
 */
export function generateMedianRewardClaimsForVoter(amount: bigint, voterWeights: VoterWeights) {
  const result: IPartialRewardClaim[] = [];
  const fee = (amount * BigInt(voterWeights.feeBIPS)) / TOTAL_BIPS;

  const participationReward = amount - fee;

  // No claims with zero amount
  if (fee > 0n) {
    const feeClaim: IPartialRewardClaim = {
      beneficiary: voterWeights.delegationAddress.toLowerCase(),
      amount: fee,
      claimType: ClaimType.FEE,
    };
    result.push(feeClaim);
  }
  if (participationReward > 0n) {
    const rewardClaim: IPartialRewardClaim = {
      beneficiary: voterWeights.delegationAddress.toLowerCase(),
      amount: participationReward,
      claimType: ClaimType.WNAT,
    };
    result.push(rewardClaim);
  }
  return result;
}
