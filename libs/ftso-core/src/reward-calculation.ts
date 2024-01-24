import coder from "web3-eth-abi";
import utils from "web3-utils";
import { ProtocolMessageMerkleRoot } from "../../fsp-utils/ProtocolMessageMerkleRoot";
import { ISignaturePayload } from "../../fsp-utils/SignaturePayload";
import { DataAvailabilityStatus, DataForRewardCalculation, DataManager } from "./DataManager";
import { GenericSubmissionData, ParsedFinalizationData } from "./IndexerClient";
import { RewardEpoch, VoterWeights } from "./RewardEpoch";
import { RewardEpochManager } from "./RewardEpochManager";
import { EPOCH_SETTINGS, FTSO2_PROTOCOL_ID } from "./configs/networks";
import { InflationRewardsOffered, RewardOffers } from "./events";
import { calculateFeedMedians } from "./ftso-calculation-logic";
import { IPartialRewardOffer, PartialRewardOffer } from "./utils/PartialRewardOffer";
import { ClaimType, IPartialRewardClaim, RewardClaim } from "./utils/RewardClaim";
import {
  Address,
  MedianCalculationResult
} from "./voting-types";
import { RandomVoterSelector } from "./RandomVoterSelector";

/////////////// REWARDING CONSTANTS ////////////////////
/**
 * Penalty factor for reveal withdrawal. Given a weight relative share of an partial reward offer's amount
 * the value is multiplied by this factor to get the penalty amount.
 */
export const PENALTY_FACTOR = 10n;  // voting rounds
export const GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC = 10; // seconds
export const GRACE_PERIOD_FOR_FINALIZATION_DURATION_SEC = 20; // seconds
export const SIGNING_REWARD_SPLIT_BIPS_TO_STAKE = 50_00n;  // BIPS (percentage)

/**
 * Price epoch reward offers are divided into three parts:
 * - 10% for finalizer of the previous epoch.
 * - 10% for signers of the previous epoch results.
 * - 80% + remainder for the median calculation results.
 */
export const SIGNING_BIPS = 10_00n;
export const FINALIZATION_BIPS = 10_00n;
export const TOTAL_BIPS = 100_00n;

/**
 * In case less then certain percentage of the total weight of the voting weight deposits signatures for a single hash,
 * in the signature rewarding window, the signatures are not rewarded.
 * In case that exactly the same weight is deposited in the signature rewarding window, for multiple hashes (e.g. 2 hashes),
 * both get reward.
 */
export const MINIMAL_REWARDED_NON_CONSENSUS_DEPOSITED_SIGNATURES_PER_HASH_BIPS = 30_00;

/**
 * The share of weight that gets randomly selected for finalization reward.
 */
export const FINALIZATION_VOTER_SELECTION_THRESHOLD_WEIGHT_BIPS = 5_00;

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
 * During each price epoch the claims are incrementally merged into cumulative claims for the
 * reward epoch which are stored in the {@link rewardEpochCumulativeRewards} map.
 *
 * The function must be called for sequential price epochs.
 */
export function splitRewardOffer(offer: IPartialRewardOffer): SplitRewardOffer {
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

export function isSignatureInGracePeriod(votingRoundId: number, signatureSubmission: GenericSubmissionData<ISignaturePayload>) {
  return signatureSubmission.votingEpochIdFromTimestamp == votingRoundId + 1 &&
    signatureSubmission.relativeTimestamp >= EPOCH_SETTINGS.revealDeadlineSeconds &&
    signatureSubmission.relativeTimestamp < EPOCH_SETTINGS.revealDeadlineSeconds + GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC;
}

export function isSignatureBeforeTimestamp(votingRoundId: number, signatureSubmission: GenericSubmissionData<ISignaturePayload>, timestamp: number) {
  return signatureSubmission.votingEpochIdFromTimestamp >= votingRoundId + 1 &&
    signatureSubmission.relativeTimestamp >= EPOCH_SETTINGS.revealDeadlineSeconds &&
    signatureSubmission.timestamp <= timestamp;
}

export function isFinalizationInGracePeriodAndEligible(votingRoundId: number, eligibleVoters: Set<Address>, finalization: ParsedFinalizationData) {
  return eligibleVoters.has(finalization.submitAddress) && finalization.votingEpochIdFromTimestamp == votingRoundId + 1 &&
    finalization.relativeTimestamp >= EPOCH_SETTINGS.revealDeadlineSeconds &&
    finalization.relativeTimestamp < EPOCH_SETTINGS.revealDeadlineSeconds + GRACE_PERIOD_FOR_FINALIZATION_DURATION_SEC;
}

export function isFinalizationOutsideOfGracePeriod(votingRoundId: number, finalization: ParsedFinalizationData) {
  return finalization.votingEpochIdFromTimestamp >= votingRoundId + 1 &&
    (
      finalization.votingEpochIdFromTimestamp > votingRoundId + 1 ||
      finalization.relativeTimestamp >= EPOCH_SETTINGS.revealDeadlineSeconds + GRACE_PERIOD_FOR_FINALIZATION_DURATION_SEC
    );
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
export function generateMedianRewardClaimsForVoter(reward: bigint, voterWeights: VoterWeights) {
  const result: IPartialRewardClaim[] = [];
  const fee = (reward * BigInt(voterWeights.feeBIPS)) / 10000n;
  const participationReward = reward - fee;
  const feeClaim: IPartialRewardClaim = {
    beneficiary: voterWeights.delegationAddress.toLowerCase(),
    amount: reward,
    claimType: ClaimType.WNAT,
  };
  result.push(feeClaim)
  const rewardClaim: IPartialRewardClaim = {
    beneficiary: voterWeights.delegationAddress.toLowerCase(),
    amount: participationReward,
    claimType: ClaimType.WNAT,
  };
  result.push(rewardClaim);
  return result;
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
 * Calculates partial reward claims for the given voting round.
 * The map @param feedOffers provides partial reward offers for each feed in the voting round.
 * For each such offer the offer is first split into three parts: median, signing and finalization.
 * Each type of offer is then processed separately with relevant reward calculation logic.
 * Result of processing yields even more specific reward claims, like fees, participation rewards, etc.
 * In addition, possible penalty claims are generated for reveal withdrawal offenders.
 * All reward claims are then merged into a single array and returned.
 * @param votingRoundId 
 * @param randomGenerationBenchingWindow 
 * @param rewardEpoch 
 * @param dataManager 
 * @param feedOffers 
 * @returns 
 */
export async function partialRewardClaimsForVotingRound(
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
    throw new Error("Critical error: Feed offers are undefined");
  }

  function initalHashSeed(protocolId: number, votingRoundId: number): string {
    return utils.soliditySha3(coder.encodeParameters(["uint256", "uint256"], [protocolId, votingRoundId]))!
  }

  const randomVoterSelector = new RandomVoterSelector(rewardEpoch.signingPolicy.voters, rewardEpoch.signingPolicy.weights.map(weight => BigInt(weight)))
  const initialHash = initalHashSeed(FTSO2_PROTOCOL_ID, votingRoundId);
  const eligibleFinalizationRewardVotersInGracePeriod = new Set(...randomVoterSelector.randomSelectThresholdWeightVoters(initialHash, FINALIZATION_VOTER_SELECTION_THRESHOLD_WEIGHT_BIPS));
  for (const [feedName, offers] of feedOffers.entries()) {
    const medianResult = medianCalculationMap.get(feedName);
    if (medianResult === undefined) {
      // This should never happen
      throw new Error("Critical error: Median result is undefined");
    }
    for (const offer of offers) {
      const splitOffers = splitRewardOffer(offer);
      const medianRewardClaims = calculateMedianRewardClaimsForPartialOffer(splitOffers.medianRewardOffer, medianResult, rewardDataForCalculations.voterWeights);
      const signingRewardClaims = calculateSigningRewards(splitOffers.signingRewardOffer, rewardDataForCalculations);
      const finalizationRewardClaims = calculateFinalizationRewards(splitOffers.finalizationRewardOffer, rewardDataForCalculations, eligibleFinalizationRewardVotersInGracePeriod);
      const penalties = calculateRevealWithdrawalPenalties(offer, totalRewardedWeight, rewardDataForCalculations);
      allRewardClaims = RewardClaim.merge([...allRewardClaims, ...medianRewardClaims, ...signingRewardClaims, ...finalizationRewardClaims, ...penalties]);
    }
  }
  return allRewardClaims;
}

/**
 * Calculates merged reward claims for the given reward epoch.
 * It triggers reward distribution throughout voting rounds and feeds, yielding reward claims that get merged at the end.
 * The resulting reward claims are then returned and can be used to assemble reward Merkle tree representing the rewards for the epoch.
 * @param rewardEpochId 
 * @param randomGenerationBenchingWindow 
 * @param dataManager 
 * @param rewardEpochManager 
 * @returns 
 */
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
    const rewardClaims = await partialRewardClaimsForVotingRound(
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
 * Given a partial reward offer, median calculation result for a specific feed and voter weights it calculates the median closeness partial 
 * reward claims for the offer for all voters (with non-zero reward). For each voter all relevant partial claims are generated (including fees, participation rewards, etc).
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

    const rewardClaims = generateMedianRewardClaimsForVoter(reward, voterWeights.get(voterRecord.voterAddress)!);
    rewardClaims.push(...rewardClaims);
  }
  // Assert
  if (totalReward !== offer.amount) {
    throw new Error(`Total reward for ${offer.feedName} is not equal to the offer amount`);
  }

  return rewardClaims;
}

/**
 * Given an amount of a reward it produces specific partial reward claims according to here defined split of the reward amount.
 * This includes split to fees and participation rewards.
 * @param amount 
 * @param signerAddress 
 * @param rewardEpoch 
 * @returns 
 */
export function signingRewardClaimsSplitForVoter(amount: bigint, signerAddress: Address, rewardEpoch: RewardEpoch): IPartialRewardClaim[] {
  const rewardClaims: IPartialRewardClaim[] = [];
  const fullVoterRegistrationInfo = rewardEpoch.fullVoterRegistrationInfoForSigner(signerAddress);
  const stakingAmount = amount * SIGNING_REWARD_SPLIT_BIPS_TO_STAKE / 10000n;
  const delegationAmount = amount - stakingAmount;
  const delegationFee = (delegationAmount * BigInt(fullVoterRegistrationInfo.voterRegistrationInfo.delegationFeeBIPS)) / 10000n;
  const delegationBeneficiary = fullVoterRegistrationInfo.voterRegistered.delegationAddress.toLowerCase();
  rewardClaims.push({
    beneficiary: delegationBeneficiary,
    amount: delegationFee,
    claimType: ClaimType.FEE,
  });
  const delegationCommunityReward = delegationAmount - delegationFee;
  rewardClaims.push({
    beneficiary: delegationBeneficiary,
    amount: delegationCommunityReward,
    claimType: ClaimType.WNAT,
  });
  let undistributedStakedWeight = 0n;
  for (let i = 0; i < fullVoterRegistrationInfo.voterRegistrationInfo.nodeIds.length; i++) {
    undistributedStakedWeight += fullVoterRegistrationInfo.voterRegistrationInfo.nodeWeights[i];
  }
  let undistributedStakedAmount = stakingAmount;

  for (let i = 0; i < fullVoterRegistrationInfo.voterRegistrationInfo.nodeIds.length; i++) {
    const nodeId = fullVoterRegistrationInfo.voterRegistrationInfo.nodeIds[i].toLowerCase();
    const weight = fullVoterRegistrationInfo.voterRegistrationInfo.nodeWeights[i];
    const nodeCommunityReward = (weight * undistributedStakedAmount) / undistributedStakedWeight;
    undistributedStakedAmount -= nodeCommunityReward;
    undistributedStakedWeight -= weight;
    // No fees are considered here. Also - no staking fee data on C-chain.
    // In future, if we want to include staking fees, we need to add them here.
    // In current setting, the staking fee would need to be read from P-chain indexer.
    // alternatively, we could use delegation fee here.
    rewardClaims.push({
      beneficiary: nodeId,
      amount: nodeCommunityReward,
      claimType: ClaimType.MIRROR,
    });
  }
  // assert 
  if (undistributedStakedAmount !== 0n) {
    throw new Error("Critical error: Undistributed staked amount is not zero");
  }
  return rewardClaims;
}

/**
 * Given an amount of a reward it produces specific partial reward claims for finalizations according to here defined split of the reward amount.
 * This includes split to fees and participation rewards.
 * @param amount 
 * @param signerAddress 
 * @param rewardEpoch 
 * @returns 
 */
export function finalizationRewardClaimsSplitForVoter(amount: bigint, signerAddress: Address, rewardEpoch: RewardEpoch): IPartialRewardClaim[] {
  const rewardClaims: IPartialRewardClaim[] = [];
  const fullVoterRegistrationInfo = rewardEpoch.fullVoterRegistrationInfoForSigner(signerAddress);
  const stakingAmount = amount * SIGNING_REWARD_SPLIT_BIPS_TO_STAKE / 10000n;
  const delegationAmount = amount - stakingAmount;
  const delegationFee = (delegationAmount * BigInt(fullVoterRegistrationInfo.voterRegistrationInfo.delegationFeeBIPS)) / 10000n;
  const delegationBeneficiary = fullVoterRegistrationInfo.voterRegistered.delegationAddress.toLowerCase();
  rewardClaims.push({
    beneficiary: delegationBeneficiary,
    amount: delegationFee,
    claimType: ClaimType.FEE,
  });
  const delegationCommunityReward = delegationAmount - delegationFee;
  rewardClaims.push({
    beneficiary: delegationBeneficiary,
    amount: delegationCommunityReward,
    claimType: ClaimType.WNAT,
  });
  let undistributedStakedWeight = 0n;
  for (let i = 0; i < fullVoterRegistrationInfo.voterRegistrationInfo.nodeIds.length; i++) {
    undistributedStakedWeight += fullVoterRegistrationInfo.voterRegistrationInfo.nodeWeights[i];
  }
  let undistributedStakedAmount = stakingAmount;

  for (let i = 0; i < fullVoterRegistrationInfo.voterRegistrationInfo.nodeIds.length; i++) {
    const nodeId = fullVoterRegistrationInfo.voterRegistrationInfo.nodeIds[i].toLowerCase();
    const weight = fullVoterRegistrationInfo.voterRegistrationInfo.nodeWeights[i];
    const nodeCommunityReward = (weight * undistributedStakedAmount) / undistributedStakedWeight;
    undistributedStakedAmount -= nodeCommunityReward;
    undistributedStakedWeight -= weight;
    // No fees are considered here. Also - no staking fee data on C-chain.
    // In future, if we want to include staking fees, we need to add them here.
    // In current setting, the staking fee would need to be read from P-chain indexer.
    // alternatively, we could use delegation fee here.
    rewardClaims.push({
      beneficiary: nodeId,
      amount: nodeCommunityReward,
      claimType: ClaimType.MIRROR,
    });
  }
  // assert 
  if (undistributedStakedAmount !== 0n) {
    throw new Error("Critical error: Undistributed staked amount is not zero");
  }
  return rewardClaims;
}

export function mostFrequentHashSignaturesBeforeDeadline(
  votingRoundId: number,
  signatures: Map<string, GenericSubmissionData<ISignaturePayload>[]>,
  totalSigningWeight: number,
  deadlineTimestamp: number,
): GenericSubmissionData<ISignaturePayload>[] {
  const result: GenericSubmissionData<ISignaturePayload>[] = [];
  let maxWeight = 0;
  const hashToWeight = new Map<string, number>();
  for (const [hash, signatureSubmissions] of signatures.entries()) {
    let weightSum = 0;
    const filteredSubmissions = signatureSubmissions
      .filter(signatureSubmission => isSignatureBeforeTimestamp(votingRoundId, signatureSubmission, deadlineTimestamp));
    for (const signatureSubmission of filteredSubmissions) {
      weightSum += signatureSubmission.messages.weight!;
    }
    hashToWeight.set(hash, weightSum);
    if (weightSum > maxWeight) {
      maxWeight = weightSum;
    }
  }
  const minimalWeightThreshold = (totalSigningWeight * MINIMAL_REWARDED_NON_CONSENSUS_DEPOSITED_SIGNATURES_PER_HASH_BIPS) / 10000;
  for (const [hash, signatureSubmissions] of signatures.entries()) {
    const weightSum = hashToWeight.get(hash)!;
    if (weightSum >= minimalWeightThreshold) {
      const filteredSubmissions = signatureSubmissions
        .filter(signatureSubmission => isSignatureBeforeTimestamp(votingRoundId, signatureSubmission, deadlineTimestamp));
      result.push(...filteredSubmissions);
    }
  }
  return result;
};

/**
 * Given an offer and data for reward calculation it calculates signing rewards for the offer.
 * The reward is distributed to signers that deposited signatures in the grace period or before the timestamp of the first successful finalization.
 * If a successful finalization for the votingRoundId does not happen before the end of the voting epoch 
 * votingRoundId + 1 + ADDITIONAL_REWARDED_FINALIZATION_WINDOWS, then the data about the finalization does not enter this function.
 * In this case rewards can be still paid out if there is (are) a signed hash which has more than certain percentage of 
 * the total weight of the voting weight deposits. 
 * TODO: think through whether to reward only in grace period or up to the end of the voting epoch id of votingRoundId + 1.
 * @param offer 
 * @param data 
 * @returns 
 */
export function calculateSigningRewards(
  offer: IPartialRewardOffer,
  data: DataForRewardCalculation,
): IPartialRewardClaim[] {
  const votingRoundId = data.dataForCalculations.votingRoundId;
  let rewardEligibleSignatures: GenericSubmissionData<ISignaturePayload>[] = [];
  if (!data.firstSuccessfulFinalization) {
    const deadlineTimestamp = EPOCH_SETTINGS.votingEpochEndSec(votingRoundId + 1);
    const signatures = mostFrequentHashSignaturesBeforeDeadline(votingRoundId, data.signatures, data.dataForCalculations.rewardEpoch.totalSigningWeight, deadlineTimestamp);
    if (signatures.length === 0) {
      const backClaim: IPartialRewardClaim = {
        beneficiary: offer.claimBackAddress.toLowerCase(),
        amount: offer.amount,
        claimType: ClaimType.DIRECT,
      };
      return [backClaim];
    }
  } else {
    const finalizedHash = ProtocolMessageMerkleRoot.hash(data.firstSuccessfulFinalization!.messages.protocolMessageMerkleRoot);
    const signatures = data.signatures.get(finalizedHash); // already filtered by hash, votingRoundId, protocolId, eligible signers

    // rewarded:
    // - all signatures in grace period (no matter of finalization timestamp)
    // - signatures outside grace period but before timestamp of first successful finalization, if the timestamp is still within before the 
    //   end of the voting epoch id = votingRoundId + 1
    const deadlineTimestamp = Math.min(data.firstSuccessfulFinalization.timestamp, EPOCH_SETTINGS.votingEpochEndSec(votingRoundId + 1));
    rewardEligibleSignatures = signatures
      .filter(signature =>
        isSignatureInGracePeriod(votingRoundId, signature) ||
        isSignatureBeforeTimestamp(votingRoundId, signature, deadlineTimestamp)
      );
  }
  let undistributedSigningRewardWeight = 0n;
  for (const signature of rewardEligibleSignatures) {
    undistributedSigningRewardWeight += BigInt(signature.messages.weight!);
  }
  let undistributedAmount = offer.amount;
  const resultClaims: IPartialRewardClaim[] = [];
  // sort signatures according to signing policy order (index in signing policy)
  rewardEligibleSignatures.sort((a, b) => a.messages.index! - b.messages.index!);

  // assert check for duplicate voter indices
  for (let i = 0; i < rewardEligibleSignatures.length - 1; i++) {
    if (rewardEligibleSignatures[i].messages.index === rewardEligibleSignatures[i + 1].messages.index) {
      throw new Error("Critical error: Duplicate voter index");
    }
  }
  for (const signature of rewardEligibleSignatures) {
    const weight = BigInt(signature.messages.weight!);
    const amount = (weight * undistributedAmount) / undistributedSigningRewardWeight;
    undistributedAmount -= amount;
    undistributedSigningRewardWeight -= weight;
    resultClaims.push(...signingRewardClaimsSplitForVoter(amount, signature.messages.signer!, data.dataForCalculations.rewardEpoch));
  }
  // assert check for undistributed amount
  if (undistributedAmount !== 0n) {
    throw new Error("Critical error: Undistributed amount is not zero");
  }
  // burn everything
  if (resultClaims.length === 0) {
    const backClaim: IPartialRewardClaim = {
      beneficiary: offer.claimBackAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
    };
    return [backClaim];
  }
  return resultClaims;
}

/**
 * 
 * @param offer 
 * @param data 
 * @returns 
 */
export function calculateFinalizationRewards(
  offer: IPartialRewardOffer,
  data: DataForRewardCalculation,
  eligibleFinalizationRewardVotersInGracePeriod: Set<Address>,
): IPartialRewardClaim[] {
  if (!data.firstSuccessfulFinalization) {
    const backClaim: IPartialRewardClaim = {
      beneficiary: offer.claimBackAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
    };
    return [backClaim];
  }
  const votingRoundId = data.dataForCalculations.votingRoundId;
  // No voter provided finalization in grace period. Whoever finalizes gets the full reward.
  if (isFinalizationOutsideOfGracePeriod(votingRoundId, data.firstSuccessfulFinalization!)) {
    const backClaim: IPartialRewardClaim = {
      beneficiary: data.firstSuccessfulFinalization!.submitAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
    };
    return [backClaim];
  }
  const gracePeriodFinalizations = data.finalizations
    .filter(finalization => isFinalizationInGracePeriodAndEligible(votingRoundId, eligibleFinalizationRewardVotersInGracePeriod, finalization));
  if (gracePeriodFinalizations.length === 0) {
    const backClaim: IPartialRewardClaim = {
      beneficiary: data.firstSuccessfulFinalization!.submitAddress.toLowerCase(),
      amount: offer.amount,
      claimType: ClaimType.DIRECT,
    };
    return [backClaim];
  }
  const rewardEpoch = data.dataForCalculations.rewardEpoch;
  let undistributedAmount = offer.amount;
  let undistributedSigningRewardWeight = 0n;
  for (const finalization of gracePeriodFinalizations) {
    const signingAddress = finalization.submitAddress.toLowerCase();
    const weight = rewardEpoch.signerToSigningWeight(signingAddress);
    undistributedSigningRewardWeight += BigInt(weight);
  }
  const resultClaims: IPartialRewardClaim[] = [];
  for (const finalization of gracePeriodFinalizations) {
    const signingAddress = finalization.submitAddress.toLowerCase();
    const weight = BigInt(rewardEpoch.signerToSigningWeight(signingAddress));
    const amount = (weight * offer.amount) / undistributedSigningRewardWeight;
    undistributedAmount -= amount;
    undistributedSigningRewardWeight -= weight;
    resultClaims.push(...finalizationRewardClaimsSplitForVoter(amount, signingAddress, data.dataForCalculations.rewardEpoch))
  }
  return resultClaims;

  // TODO: distribute rewards
}

/**
 * Given a full reward offer, total rewarded weight and data for reward calculation it calculates penalty claims for reveal withdrawal offenders.
 * The penalty amount is proportional to the weight of the offender.
 * @param fullOffer 
 * @param totalRewardedWeight 
 * @param data 
 * @returns 
 */
export function calculateRevealWithdrawalPenalties(
  fullOffer: IPartialRewardOffer,
  totalRewardedWeight: bigint,
  data: DataForRewardCalculation,
): IPartialRewardClaim[] {
  return [...data.dataForCalculations.revealOffenders].map(submitAddress => {
    const voterWeight = rewardDistributionWeight(data.voterWeights.get(submitAddress)!);
    const penalty = - (voterWeight * fullOffer.amount) / totalRewardedWeight * PENALTY_FACTOR;
    const penaltyClaim: IPartialRewardClaim = {
      beneficiary: submitAddress.toLowerCase(),
      amount: penalty,
      claimType: ClaimType.DIRECT,
    };
    return penaltyClaim;
  })
}



