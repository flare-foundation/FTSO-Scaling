import { DataAvailabilityStatus, DataManager } from "../DataManager";
import { RewardEpochManager } from "../RewardEpochManager";
import {
  CALCULATIONS_FOLDER,
  FINALIZATION_VOTER_SELECTION_THRESHOLD_WEIGHT_BIPS,
  FTSO2_PROTOCOL_ID,
  PENALTY_FACTOR,
} from "../configs/networks";
import { calculateMedianResults } from "../ftso-calculation/ftso-median";
import { IMergeableRewardClaim, IPartialRewardClaim, IRewardClaim, RewardClaim } from "../utils/RewardClaim";
import { RewardEpochDuration } from "../utils/RewardEpochDuration";
import { MedianCalculationResult } from "../voting-types";
import { RandomVoterSelector } from "./RandomVoterSelector";
import { RewardTypePrefix } from "./RewardTypePrefix";
import { calculateDoubleSigners } from "./reward-double-signers";
import { calculateFinalizationRewardClaims } from "./reward-finalization";
import { calculateMedianRewardClaims } from "./reward-median";
import { granulatedPartialOfferMap, splitRewardOfferByTypes } from "./reward-offers";

import { calculateRandom } from "../ftso-calculation/ftso-random";
import { MerkleTreeStructs } from "../utils/MerkleTreeStructs";
import { IPartialRewardOfferForRound } from "../utils/PartialRewardOffer";
import {
  aggregatedClaimsForVotingRoundIdExist,
  deserializeAggregatedClaimsForVotingRoundId,
  serializeAggregatedClaimsForVotingRoundId,
} from "../utils/stat-info/aggregated-claims";
import { serializeFeedValuesForVotingRoundId } from "../utils/stat-info/feed-values";
import {
  deserializeGranulatedPartialOfferMap,
  serializeGranulatedPartialOfferMap,
} from "../utils/stat-info/granulated-partial-offers-map";
import {
  deserializePartialClaimsForVotingRoundId,
  serializePartialClaimsForVotingRoundId,
} from "../utils/stat-info/partial-claims";
import { calculatePenalties } from "./reward-penalties";
import { calculateSigningRewards } from "./reward-signing";
import { destroyStorage } from "../utils/stat-info/storage";
import { serializeDataForRewardCalculation } from "../utils/stat-info/reward-calculation-data";

/**
 * Calculates merged reward claims for the given reward epoch.
 * It triggers reward distribution throughout voting rounds and feeds, yielding reward claims that get merged at the end.
 * The resulting reward claims are then returned and can be used to assemble reward Merkle tree representing the rewards for the epoch.
 */
export async function rewardClaimsForRewardEpoch(
  rewardEpochId: number,
  randomGenerationBenchingWindow: number,
  dataManager: DataManager,
  rewardEpochManager: RewardEpochManager,
  merge = true,
  addLog = false,
  serialize = false,
  forceDestroyStorage = false
): Promise<IRewardClaim[] | IPartialRewardClaim[]> {
  if (serialize && forceDestroyStorage) {
    destroyStorage(rewardEpochId);
  }
  const { startVotingRoundId, endVotingRoundId } = await rewardEpochManager.getRewardEpochDurationRange(rewardEpochId);
  const rewardEpoch = await rewardEpochManager.getRewardEpochForVotingEpochId(startVotingRoundId);
  // Partial offer generation from reward offers
  // votingRoundId => feedName => partialOffer
  const rewardOfferMap: Map<number, Map<string, IPartialRewardOfferForRound[]>> = granulatedPartialOfferMap(
    startVotingRoundId,
    endVotingRoundId,
    rewardEpoch.rewardOffers
  );

  // Reward claim calculation
  let allRewardClaims: IPartialRewardClaim[] = [];
  for (let votingRoundId = startVotingRoundId; votingRoundId <= endVotingRoundId; votingRoundId++) {
    const rewardClaims = await partialRewardClaimsForVotingRound(
      rewardEpochId,
      votingRoundId,
      randomGenerationBenchingWindow,
      dataManager,
      rewardOfferMap.get(votingRoundId),
      merge,
      addLog
    );
    allRewardClaims.push(...rewardClaims);
    if (merge) {
      allRewardClaims = RewardClaim.merge(allRewardClaims);
    }
  }
  if (merge) {
    return RewardClaim.convertToRewardClaims(rewardEpochId, allRewardClaims);
  }
  return allRewardClaims;
}

/**
 * Initializes reward epoch storage for the given reward epoch.
 * Creates calculation folders with granulated offer data.
 */
export async function initializeRewardEpochStorage(
  rewardEpochId: number,
  rewardEpochManager: RewardEpochManager,
  useExpectedEndIfNoSigningPolicyAfter = false,
  calculationFolder = CALCULATIONS_FOLDER()
): Promise<RewardEpochDuration> {
  const rewardEpochDuration = await rewardEpochManager.getRewardEpochDurationRange(
    rewardEpochId,
    useExpectedEndIfNoSigningPolicyAfter
  );
  const rewardEpoch = await rewardEpochManager.getRewardEpochForVotingEpochId(rewardEpochDuration.startVotingRoundId);
  // Partial offer generation from reward offers
  // votingRoundId => feedName => partialOffer
  const rewardOfferMap: Map<number, Map<string, IPartialRewardOfferForRound[]>> = granulatedPartialOfferMap(
    rewardEpochDuration.startVotingRoundId,
    rewardEpochDuration.endVotingRoundId,
    rewardEpoch.rewardOffers
  );
  // sync call
  serializeGranulatedPartialOfferMap(rewardEpochDuration, rewardOfferMap, calculationFolder);
  return rewardEpochDuration;
}

/**
 * Calculates partial reward claims for the given voting round.
 * The map @param feedOffers provides partial reward offers for each feed in the voting round.
 * For each such offer the offer is first split into three parts: median, signing and finalization.
 * Each type of offer is then processed separately with relevant reward calculation logic.
 * Result of processing yields even more specific reward claims, like fees, participation rewards, etc.
 * In addition, possible penalty claims are generated for reveal withdrawal offenders.
 * All reward claims are then merged into a single array and returned.
 */
export async function partialRewardClaimsForVotingRound(
  rewardEpochId: number,
  votingRoundId: number,
  randomGenerationBenchingWindow: number,
  dataManager: DataManager,
  feedOffersParam: Map<string, IPartialRewardOfferForRound[]> | undefined,
  merge = true,
  addLog = false,
  serializeResults = false,
  calculationFolder = CALCULATIONS_FOLDER()
): Promise<IPartialRewardClaim[]> {
  let feedOffers = feedOffersParam;
  if (feedOffers === undefined) {
    feedOffers = deserializeGranulatedPartialOfferMap(rewardEpochId, votingRoundId, calculationFolder);
  }
  let allRewardClaims: IPartialRewardClaim[] = [];
  // Obtain data for reward calculation
  const rewardDataForCalculationResponse = await dataManager.getDataForRewardCalculation(
    votingRoundId,
    randomGenerationBenchingWindow
  );
  if (rewardDataForCalculationResponse.status !== DataAvailabilityStatus.OK) {
    throw new Error(`Data availability status is not OK: ${rewardDataForCalculationResponse.status}`);
  }

  const rewardDataForCalculations = rewardDataForCalculationResponse.data;
  const rewardEpoch = rewardDataForCalculations.dataForCalculations.rewardEpoch;

  const voterWeights = rewardEpoch.getVotersWeights();

  // Calculate feed medians
  const medianResults: MedianCalculationResult[] = calculateMedianResults(
    rewardDataForCalculations.dataForCalculations
  );

  if (serializeResults) {
    const randomData = calculateRandom(rewardDataForCalculations.dataForCalculations);
    const calculationResults = [
      MerkleTreeStructs.fromRandomCalculationResult(randomData),
      ...medianResults.map(result => MerkleTreeStructs.fromMedianCalculationResult(result)),
    ];
    serializeFeedValuesForVotingRoundId(rewardEpochId, votingRoundId, calculationResults, calculationFolder);
    serializeDataForRewardCalculation(rewardEpochId, rewardDataForCalculations);
  }

  // feedName => medianResult
  const medianCalculationMap = new Map<string, MedianCalculationResult>();
  for (const medianResult of medianResults) {
    medianCalculationMap.set(medianResult.feed.name, medianResult);
  }

  // Select eligible voters for finalization rewards
  const randomVoterSelector = new RandomVoterSelector(
    rewardEpoch.signingPolicy.voters,
    rewardEpoch.signingPolicy.weights.map(weight => BigInt(weight)),
    FINALIZATION_VOTER_SELECTION_THRESHOLD_WEIGHT_BIPS()
  );

  const initialHash = RandomVoterSelector.initialHashSeed(
    rewardEpoch.signingPolicy.seed,
    FTSO2_PROTOCOL_ID,
    votingRoundId
  );
  const eligibleFinalizationRewardVotersInGracePeriod = new Set(
    randomVoterSelector.randomSelectThresholdWeightVoters(initialHash)
  );

  // Calculate reward claims for each feed offer
  for (const [feedName, offers] of feedOffers.entries()) {
    const medianResult = medianCalculationMap.get(feedName);
    if (medianResult === undefined) {
      // This should never happen
      throw new Error("Critical error: Median result is undefined");
    }
    // Calculate reward claims for each offer
    for (const offer of offers) {
      // First each offer is split into three parts: median, signing and finalization
      const splitOffers = splitRewardOfferByTypes(offer);
      // From each partial offer in split calculate reward claims
      const medianRewardClaims = calculateMedianRewardClaims(
        splitOffers.medianRewardOffer,
        medianResult,
        voterWeights,
        addLog
      );
      const signingRewardClaims = calculateSigningRewards(
        splitOffers.signingRewardOffer,
        rewardDataForCalculations,
        addLog
      );
      const finalizationRewardClaims = calculateFinalizationRewardClaims(
        splitOffers.finalizationRewardOffer,
        rewardDataForCalculations,
        eligibleFinalizationRewardVotersInGracePeriod,
        addLog
      );

      // Calculate penalties for reveal withdrawal offenders
      const revealWithdrawalPenalties = calculatePenalties(
        offer,
        PENALTY_FACTOR(),
        rewardDataForCalculations.dataForCalculations.revealOffenders,
        voterWeights,
        addLog,
        RewardTypePrefix.REVEAL_OFFENDERS
      );

      // Calculate penalties for reveal double signers
      // get signingAddresses of double signers
      const doubleSigners = calculateDoubleSigners(
        votingRoundId,
        FTSO2_PROTOCOL_ID,
        rewardDataForCalculations.signatures
      );

      // convert signingAddresses to submitAddresses
      const doubleSignersSubmit = new Set(
        [...doubleSigners.keys()].map(signingAddress => rewardEpoch.signingAddressToSubmitAddress.get(signingAddress))
      );

      //distribute penalties
      const doubleSigningPenalties = calculatePenalties(
        offer,
        PENALTY_FACTOR(),
        doubleSignersSubmit,
        voterWeights,
        addLog,
        RewardTypePrefix.DOUBLE_SIGNERS
      );

      // Merge all reward claims into a single array
      allRewardClaims.push(...medianRewardClaims);
      allRewardClaims.push(...signingRewardClaims);
      allRewardClaims.push(...finalizationRewardClaims);
      allRewardClaims.push(...revealWithdrawalPenalties);
      allRewardClaims.push(...doubleSigningPenalties);
      if (merge) {
        allRewardClaims = RewardClaim.merge(allRewardClaims);
      }
    }
  }
  if (serializeResults) {
    serializePartialClaimsForVotingRoundId(rewardEpochId, votingRoundId, allRewardClaims, calculationFolder);
  }
  return allRewardClaims;
}

/**
 * If force recalculate is set to true, the startVotingRoundId is considered as the first voting round
 * so partial claims from there are taken for first merge. Then all aggregated reward claims are calculated
 * up to endVotingRoundId.
 * Otherwise startVotingRoundId is considered to have calculated aggregate. If so, for each
 * next voting round it is first checked whether the aggregate is already calculated. If not, it is calculated.
 * Then the procedure is repeated incrementally until endVotingRoundId. Consequently, aggregated reward claims
 * are calculated only if they are not already calculated.
 */
export function aggregateRewardClaimsInStorage(
  rewardEpochId: number,
  startVotingRoundId: number,
  endVotingRoundId: number,
  forceRecalculate = false,
  calculationFolder = CALCULATIONS_FOLDER()
) {
  if (forceRecalculate) {
    const partialClaims: IMergeableRewardClaim[] = deserializePartialClaimsForVotingRoundId(
      rewardEpochId,
      startVotingRoundId,
      calculationFolder
    );
    let aggregatedClaims = RewardClaim.convertToRewardClaims(rewardEpochId, partialClaims);
    serializeAggregatedClaimsForVotingRoundId(rewardEpochId, startVotingRoundId, aggregatedClaims, calculationFolder);
    for (let votingRoundId = startVotingRoundId + 1; votingRoundId <= endVotingRoundId; votingRoundId++) {
      const partialClaims = deserializePartialClaimsForVotingRoundId(rewardEpochId, votingRoundId, calculationFolder);
      if (partialClaims === undefined) {
        throw new Error("Partial claims are undefined");
      }
      aggregatedClaims = RewardClaim.convertToRewardClaims(
        rewardEpochId,
        RewardClaim.merge([...aggregatedClaims, ...partialClaims])
      );
      serializeAggregatedClaimsForVotingRoundId(rewardEpochId, votingRoundId, aggregatedClaims, calculationFolder);
    }
    return;
  }
  if (!aggregatedClaimsForVotingRoundIdExist(rewardEpochId, startVotingRoundId, calculationFolder)) {
    throw new Error(`Aggregated claims are not calculated for start voting round: ${startVotingRoundId}`);
  }
  let aggregatedClaims: IRewardClaim[] = deserializeAggregatedClaimsForVotingRoundId(
    rewardEpochId,
    startVotingRoundId,
    calculationFolder
  );
  for (let votingRoundId = startVotingRoundId + 1; votingRoundId <= endVotingRoundId; votingRoundId++) {
    if (aggregatedClaimsForVotingRoundIdExist(rewardEpochId, votingRoundId, calculationFolder)) {
      aggregatedClaims = deserializeAggregatedClaimsForVotingRoundId(rewardEpochId, votingRoundId, calculationFolder);
      continue;
    }
    const partialClaims = deserializePartialClaimsForVotingRoundId(rewardEpochId, votingRoundId, calculationFolder);
    if (partialClaims === undefined) {
      throw new Error("Partial claims are undefined");
    }
    aggregatedClaims = RewardClaim.convertToRewardClaims(
      rewardEpochId,
      RewardClaim.merge([...aggregatedClaims, ...partialClaims])
    );
    serializeAggregatedClaimsForVotingRoundId(rewardEpochId, votingRoundId, aggregatedClaims, calculationFolder);
  }
}
