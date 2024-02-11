import { DataAvailabilityStatus, DataManager } from "../DataManager";
import { RewardEpoch } from "../RewardEpoch";
import { RewardEpochManager } from "../RewardEpochManager";
import { FINALIZATION_VOTER_SELECTION_THRESHOLD_WEIGHT_BIPS, FTSO2_PROTOCOL_ID } from "../configs/networks";
import { calculateMedianResults } from "../ftso-calculation/ftso-median";
import { IPartialRewardOffer } from "../utils/PartialRewardOffer";
import { IPartialRewardClaim, IRewardClaim, RewardClaim } from "../utils/RewardClaim";
import { MedianCalculationResult } from "../voting-types";
import { RandomVoterSelector } from "./RandomVoterSelector";
import { calculateDoubleSigningPenalties } from "./reward-double-signing-penalties";
import { calculateFinalizationRewardClaims } from "./reward-finalization";
import { calculateMedianRewardClaims } from "./reward-median";
import { granulatedPartialOfferMap, splitRewardOfferByTypes } from "./reward-offers";
import { calculateRevealWithdrawalPenalties } from "./reward-reveal-withdrawal-penalties";
import { calculateSigningRewards } from "./reward-signing";

/**
 * Calculates merged reward claims for the given reward epoch.
 * It triggers reward distribution throughout voting rounds and feeds, yielding reward claims that get merged at the end.
 * The resulting reward claims are then returned and can be used to assemble reward Merkle tree representing the rewards for the epoch.
 */
export async function rewardClaimsForRewardEpoch(
  rewardEpochId: number,
  randomGenerationBenchingWindow: number,
  dataManager: DataManager,
  rewardEpochManager: RewardEpochManager
): Promise<IRewardClaim[]> {
  // Reward epoch definitions

  const { startVotingRoundId, endVotingRoundId } = await rewardEpochManager.getRewardEpochDurationRange(rewardEpochId);
  const rewardEpoch = await rewardEpochManager.getRewardEpochForVotingEpochId(startVotingRoundId);
  // Partial offer generation from reward offers
  // votingRoundId => feedName => partialOffer
  const rewardOfferMap: Map<number, Map<string, IPartialRewardOffer[]>> = granulatedPartialOfferMap(
    startVotingRoundId,
    endVotingRoundId,
    rewardEpoch.rewardOffers
  );

  // Reward claim calculation
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
  return RewardClaim.convertToRewardClaims(rewardEpochId, allRewardClaims);
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
  votingRoundId: number,
  randomGenerationBenchingWindow: number,
  rewardEpoch: RewardEpoch,
  dataManager: DataManager,
  feedOffers: Map<string, IPartialRewardOffer[]>
): Promise<IPartialRewardClaim[]> {
  let allRewardClaims: IPartialRewardClaim[] = [];
  // Obtain data for reward calculation
  const rewardDataForCalculationResponse = await dataManager.getDataForRewardCalculation(
    votingRoundId,
    randomGenerationBenchingWindow,
    rewardEpoch
  );
  if (rewardDataForCalculationResponse.status !== DataAvailabilityStatus.OK) {
    throw new Error(`Data availability status is not OK: ${rewardDataForCalculationResponse.status}`);
  }

  const rewardDataForCalculations = rewardDataForCalculationResponse.data;

  // Calculate feed medians
  const medianResults: MedianCalculationResult[] = calculateMedianResults(
    rewardDataForCalculations.dataForCalculations
  );
  // feedName => medianResult
  const medianCalculationMap = new Map<string, MedianCalculationResult>();
  for (const medianResult of medianResults) {
    medianCalculationMap.set(medianResult.feed.name, medianResult);
  }
  if (feedOffers === undefined) {
    // This should never happen
    throw new Error("Critical error: Feed offers are undefined");
  }

  // Select eligible voters for finalization rewards
  const randomVoterSelector = new RandomVoterSelector(
    rewardEpoch.signingPolicy.voters,
    rewardEpoch.signingPolicy.weights.map(weight => BigInt(weight)),
    FINALIZATION_VOTER_SELECTION_THRESHOLD_WEIGHT_BIPS()
  );

  const initialHash = RandomVoterSelector.initialHashSeed(rewardEpoch.signingPolicy.seed, FTSO2_PROTOCOL_ID, votingRoundId);
  const eligibleFinalizationRewardVotersInGracePeriod = new Set(randomVoterSelector.randomSelectThresholdWeightVoters(initialHash));

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
        rewardDataForCalculations.voterWeights
      );
      const signingRewardClaims = calculateSigningRewards(splitOffers.signingRewardOffer, rewardDataForCalculations);
      const finalizationRewardClaims = calculateFinalizationRewardClaims(
        splitOffers.finalizationRewardOffer,
        rewardDataForCalculations,
        eligibleFinalizationRewardVotersInGracePeriod
      );
      // Calculate penalties for reveal withdrawal offenders
      const revealWithdrawalPenalties = calculateRevealWithdrawalPenalties(
        offer,
        rewardDataForCalculations.dataForCalculations.revealOffenders,
        rewardDataForCalculations.dataForCalculations.rewardEpoch,
        rewardDataForCalculations.voterWeights
      );

      const doubleSigningPenalties = calculateDoubleSigningPenalties(
        offer,
        rewardDataForCalculations.signatures,
        rewardDataForCalculations.dataForCalculations.rewardEpoch,
        rewardDataForCalculations.voterWeights
      );
      // Merge all reward claims into a single array
      allRewardClaims = RewardClaim.merge([
        ...allRewardClaims,
        ...medianRewardClaims,
        ...signingRewardClaims,
        ...finalizationRewardClaims,
        ...revealWithdrawalPenalties,
        ...doubleSigningPenalties,
      ]);
    }
  }
  return allRewardClaims;
}
