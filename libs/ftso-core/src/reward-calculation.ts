import coder from "web3-eth-abi";
import utils from "web3-utils";
import { DataAvailabilityStatus, DataForRewardCalculation, DataManager } from "./DataManager";
import { RewardEpoch, VoterWeights } from "./RewardEpoch";
import { RewardEpochManager } from "./RewardEpochManager";
import { InflationRewardsOffered, RewardOffers } from "./events";
import { calculateFeedMedians } from "./ftso-calculation-logic";
import { IPartialRewardOffer, PartialRewardOffer } from "./utils/PartialRewardOffer";
import { ClaimType, IPartialRewardClaim, RewardClaim } from "./utils/RewardClaim";
import {
  Address,
  MedianCalculationResult
} from "./voting-types";


/**
 * A split of partial reward offer into three parts:
 */
export interface SplitRewardOffer {
  readonly medianRewardOffer: IPartialRewardOffer;
  readonly signingRewardOffer: IPartialRewardOffer;
  readonly finalizationRewardOffer: IPartialRewardOffer;
}
/**
 * Calculates the claims for the given price epoch.
 *
 * Price epoch reward offers are divided into three parts:
 * - 10% for finalizer of the previous epoch: {@link finalizerAddress}.
 * - 10% for signers of the previous epoch results: {@link signers}.
 * - 80% + remainder for the median calculation results.
 *
 * During each price epoch the claims are incrementally merged into cumulative claims for the
 * reward epoch which are stored in the {@link rewardEpochCumulativeRewards} map.
 *
 * The function must be called for sequential price epochs.
 */
export function splitRewardOffer(offer: IPartialRewardOffer, SIGNING_BIPS = 10_00n, FINALIZATION_BIPS = 10_00n, TOTAL_BIPS = 100_00n): SplitRewardOffer {
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
  }
  return result;
}

/**
 * Returns reward distribution weight for the voter.
 * @param voterWeights 
 * @returns 
 */
export function rewardDistributionWeight(voterWeights: VoterWeights): bigint {
  return voterWeights.cappedDelegationWeight;
}

/**
 * Penalty factor for reveal withdrawal. Given a weight relative share of an partial reward offer's amount
 * the value is multiplied by this factor to get the penalty amount.
 * @returns 
 */
export function penaltyFactor(): bigint {
  return 10n;
}

export function gracePeriodForSignaturesDurationSec() {
  return 10;
}

export function gracePeriodForFinalizationDurationSec() {
  return 20;
}

export function distributeInflationRewardOfferToFeeds(inflationRewardOffer: InflationRewardsOffered): IPartialRewardOffer[] {
  if (inflationRewardOffer.mode === 0) {
    return PartialRewardOffer.fromInflationRewardOfferedEquallyDistributed(inflationRewardOffer);
  }
  throw new Error(`Mode ${inflationRewardOffer.mode} is not supported`);
}
/**
 * Given assigned reward it generates reward claims for the voter. 
 * Currently only a partial fee claim and capped wnat delegation participation weight claims are created.
 * @param reward 
 * @param voterWeights 
 * @returns 
 */
export function generateRewardClaimsForVoter(reward: bigint, voterWeights: VoterWeights) {
  const result: IPartialRewardClaim[] = [];
  const fee = (reward * BigInt(voterWeights.feeBIPS)) / 10000n;
  const participationReward = reward - fee;
  const feeClaim: IPartialRewardClaim = {
    beneficiary: voterWeights.submitAddress.toLowerCase(),
    amount: reward,
    claimType: ClaimType.WNAT,
  };
  result.push(feeClaim)
  const rewardClaim: IPartialRewardClaim = {
    beneficiary: voterWeights.submitAddress.toLowerCase(),
    amount: participationReward,
    claimType: ClaimType.WNAT,
  };
  result.push(rewardClaim);
  return result;
}

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

export async function rewardOffersForVotingRound(
  votingRoundId: number,
  randomGenerationBenchingWindow: number,
  rewardEpoch: RewardEpoch,
  dataManager: DataManager,
  feedOffers: Map<string, IPartialRewardOffer[]>
): Promise<IPartialRewardClaim[]> {
  let allRewardClaims: IPartialRewardClaim[] = [];
  const rewardDataForCalculationResponse = await dataManager.getDataForRewardCalculation(votingRoundId, randomGenerationBenchingWindow, rewardEpoch);
  if (rewardDataForCalculationResponse.status !== DataAvailabilityStatus.OK) {
    throw new Error(`Data availability status is not OK: ${rewardDataForCalculationResponse.status}`);
  }
  const totalRewardedWeight = [...rewardDataForCalculationResponse.data.voterWeights.values()]
    .map(voterWeight => rewardDistributionWeight(voterWeight))
    .reduce((a, b) => a + b, 0n);

  const rewardDataForCalculations = rewardDataForCalculationResponse.data;
  const medianResults: MedianCalculationResult[] = await calculateFeedMedians(rewardDataForCalculations.dataForCalculations);
  // feedName => medianResult
  const medianCalculationMap = new Map<string, MedianCalculationResult>();
  for (const medianResult of medianResults) {
    medianCalculationMap.set(medianResult.feed.name, medianResult);
  }
  if (feedOffers === undefined) {
    // This should never happen
    return [];
  }
  for (const [feedName, offers] of feedOffers.entries()) {
    const medianResult = medianCalculationMap.get(feedName);
    if (medianResult === undefined) {
      // This should never happen
      return []
    }
    for (const offer of offers) {
      const splitOffers = splitRewardOffer(offer);
      const medianRewardClaims = calculateMedianRewardClaimsForPartialOffer(splitOffers.medianRewardOffer, medianResult, rewardDataForCalculations.voterWeights);
      const signingRewardClaims = calculateSigningRewards(splitOffers.signingRewardOffer, rewardDataForCalculations);
      const finalizationRewardClaims = calculateFinalizationRewards(splitOffers.finalizationRewardOffer, rewardDataForCalculations);
      const penalties = calculateRevealWithdrawalPenalties(offer, totalRewardedWeight, rewardDataForCalculations);
      allRewardClaims = RewardClaim.merge([...allRewardClaims, ...medianRewardClaims, ...signingRewardClaims, ...finalizationRewardClaims, ...penalties]);
    }
  }
  return allRewardClaims;
}

export async function calculateRewardOffersForRewardEpoch(
  rewardEpochId: number,
  randomGenerationBenchingWindow: number,
  dataManager: DataManager,
  rewardEpochManager: RewardEpochManager
) {
  const rewardEpoch = await rewardEpochManager.getRewardEpoch(rewardEpochId);
  const { startVotingRoundId, endVotingRoundId } = await rewardEpochManager.getRewardEpochDurationRange(rewardEpochId);
  // votingRoundId => feedName => partialOffer
  const rewardOfferMap: Map<number, Map<string, IPartialRewardOffer[]>> = granulatedPartialOfferMap(startVotingRoundId, endVotingRoundId, rewardEpoch.rewardOffers);

  let allRewardClaims: IPartialRewardClaim[] = [];
  for (let votingRoundId = startVotingRoundId; votingRoundId <= endVotingRoundId; votingRoundId++) {
    const rewardClaims = await rewardOffersForVotingRound(
      votingRoundId,
      randomGenerationBenchingWindow,
      rewardEpoch,
      dataManager,
      rewardOfferMap.get(votingRoundId)
    );
    allRewardClaims = RewardClaim.merge([...allRewardClaims, ...rewardClaims]);
  }
  return allRewardClaims;
}


/**
 * Give a partial reward offer, median calculation result and voter weights it calculates the median closeness reward claims for the offer.
 * @param offer 
 * @param calculationResult 
 * @param voterWeights 
 * @returns 
 */
export function calculateMedianRewardClaimsForPartialOffer(
  offer: IPartialRewardOffer,
  calculationResult: MedianCalculationResult,
  voterWeights: Map<Address, VoterWeights>,
): IPartialRewardClaim[] {

  interface VoterRewarding {
    readonly voterAddress: string;
    weight: bigint;
    readonly originalWeight: bigint;
    readonly pct: boolean; // gets PCT reward
    readonly iqr: boolean; // gets IQR reward
    readonly eligible: boolean; // is eligible for reward
  }

  if (offer.votingRoundId === undefined) {
    throw new Error("Offer price epoch does not match the current price epoch");
  }
  const votingRoundId = offer.votingRoundId;
  if (calculationResult.votingRoundId !== votingRoundId) {
    throw new Error("Calculation result voting round id does not match the offer voting round id");
  }

  // Randomization for border cases
  // - a random for IQR belt is calculated from hash(priceEpochId, slotId, address)
  function randomSelect(feedName: string, votingRoundId: number, voterAddress: Address): boolean {
    return BigInt(
      utils.soliditySha3(coder.encodeParameters(["bytes8", "uint256", "address"], [feedName, votingRoundId, voterAddress]))!
    ) % 2n === 1n;
  }

  if (calculationResult.data.finalMedianPrice.isEmpty) {
    return [];
  }
  // Use bigint for proper integer division
  const medianPrice = BigInt(calculationResult.data.finalMedianPrice.value);

  // establish boundaries
  if (calculationResult.data.quartile1Price.isEmpty || calculationResult.data.quartile3Price.isEmpty) {
    throw new Error("Critical error: quartile prices are not available. This should never happen.");
  }
  const lowIQR = BigInt(calculationResult.data.quartile1Price.value);
  const highIQR = BigInt(calculationResult.data.quartile3Price.value);

  const voterRecords: VoterRewarding[] = [];

  const elasticBandDiff = (medianPrice * BigInt(offer.secondaryBandWidthPPM)) / 1000000n;

  const lowPCT = medianPrice - elasticBandDiff;
  const highPCT = medianPrice + elasticBandDiff;

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
      weight: rewardDistributionWeight(voterWeights.get(voterAddress)!),
      originalWeight: calculationResult.weights![i],
      iqr:
        (value > lowIQR && value < highIQR) ||
        ((value === lowIQR || value === highIQR) && randomSelect(offer.feedName, votingRoundId, voterAddress)),
      pct: value > lowPCT && value < highPCT,
      eligible: true
    };
    voterRecords.push(record);
  }

  // calculate iqr and pct sums
  let iqrSum = 0n;
  let pctSum: 0n;
  for (const voterRecord of voterRecords) {
    if (!voterRecord.eligible) {
      continue;
    }
    if (voterRecord.iqr) {
      iqrSum += voterRecord.weight;
    }
    if (voterRecord.pct) {
      pctSum += voterRecord.weight;
    }
  }

  // calculate total rewarded weight
  let totalRewardedWeight = 0n;
  for (const voterRecord of voterRecords) {
    if (!voterRecord.eligible) {
      voterRecord.weight = 0n
      continue;
    }
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
        newWeight += BigInt(offer.secondaryBandWidthPPM) * voterRecord.weight * iqrSum;
      }
    }
    voterRecord.weight = newWeight;
    totalRewardedWeight += newWeight;
  }

  if (totalRewardedWeight === 0n) {
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
  let availableWeight = totalRewardedWeight;

  for (const voterRecord of voterRecords) {
    // double declining balance
    if (voterRecord.weight === 0n) {
      continue;
    }
    const reward = (voterRecord.weight * availableReward) / availableWeight;
    availableReward = availableReward - reward;
    availableWeight = availableWeight - voterRecord.weight;

    totalReward += reward;

    const rewardClaims = generateRewardClaimsForVoter(reward, voterWeights.get(voterRecord.voterAddress)!);
    rewardClaims.push(...rewardClaims);
  }
  // Assert
  if (totalReward !== offer.amount) {
    throw new Error(`Total reward for ${offer.feedName} is not equal to the offer amount`);
  }

  return rewardClaims;
}


export function calculateSigningRewards(
  offer: IPartialRewardOffer,
  data: DataForRewardCalculation,
): IPartialRewardClaim[] {
  const votingRoundId = data.dataForCalculations.votingRoundId;

  return [];
}

export function calculateFinalizationRewards(
  offer: IPartialRewardOffer,
  data: DataForRewardCalculation,
): IPartialRewardClaim[] {
  // TODO
  return [];
}

export function calculateRevealWithdrawalPenalties(
  fullOffer: IPartialRewardOffer,
  totalRewardedWeight: bigint,
  data: DataForRewardCalculation,
): IPartialRewardClaim[] {
  return [...data.dataForCalculations.revealOffenders].map(submitAddress => {
    const voterWeight = rewardDistributionWeight(data.voterWeights.get(submitAddress)!);
    const penalty = - (voterWeight * fullOffer.amount) / totalRewardedWeight * penaltyFactor();
    const penaltyClaim: IPartialRewardClaim = {
      beneficiary: submitAddress.toLowerCase(),
      amount: penalty,
      claimType: ClaimType.DIRECT,
    };
    return penaltyClaim;
  })
}



