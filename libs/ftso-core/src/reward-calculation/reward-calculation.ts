import { DataAvailabilityStatus, DataManager } from "../DataManager";
import { RewardEpochManager } from "../RewardEpochManager";
import {
  CALCULATIONS_FOLDER,
  FINALIZATION_VOTER_SELECTION_THRESHOLD_WEIGHT_BIPS,
  FTSO2_PROTOCOL_ID,
  PENALTY_FACTOR,
} from "../configs/networks";
import { calculateMedianResults } from "../ftso-calculation/ftso-median";
import { ClaimType, IMergeableRewardClaim, IPartialRewardClaim, IRewardClaim, RewardClaim } from "../utils/RewardClaim";
import { RewardEpochDuration } from "../utils/RewardEpochDuration";
import { MedianCalculationResult } from "../voting-types";
import { RandomVoterSelector } from "./RandomVoterSelector";
import { RewardTypePrefix } from "./RewardTypePrefix";
import { calculateDoubleSigners } from "./reward-double-signers";
import { calculateFinalizationRewardClaims } from "./reward-finalization";
import { calculateMedianRewardClaims } from "./reward-median";
import { splitRewardOfferByTypes } from "./reward-offers";

import { DataManagerForRewarding } from "../DataManagerForRewarding";
import { RewardEpoch } from "../RewardEpoch";
import { FUFeedValue } from "../data-calculation-interfaces";
import { FastUpdateFeedConfiguration } from "../events/FUInflationRewardsOffered";
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
  createRewardCalculationFolders,
  deserializeGranulatedPartialOfferMap,
  deserializeGranulatedPartialOfferMapForFastUpdates,
} from "../utils/stat-info/granulated-partial-offers-map";
import {
  deserializePartialClaimsForVotingRoundId,
  serializePartialClaimsForVotingRoundId,
} from "../utils/stat-info/partial-claims";
import {
  augmentDataForRewardCalculation,
  deserializeDataForRewardCalculation,
  serializeDataForRewardCalculation,
} from "../utils/stat-info/reward-calculation-data";
import { deserializeRewardEpochInfo } from "../utils/stat-info/reward-epoch-info";
import { calculateFastUpdatesClaims } from "./reward-fast-updates";
import { calculatePenalties } from "./reward-penalties";
import { calculateSigningRewards } from "./reward-signing";
import { ILogger } from "../utils/ILogger";

/**
 * Initializes reward epoch storage for the given reward epoch.
 * Creates calculation folders with granulated offer data.
 */
export async function initializeRewardEpochStorage(
  rewardEpochId: number,
  rewardEpochManager: RewardEpochManager,
  useExpectedEndIfNoSigningPolicyAfter = false,
  tempRewardEpochFolder = false,
  calculationFolder = CALCULATIONS_FOLDER()
): Promise<[RewardEpochDuration, RewardEpoch]> {
  const rewardEpochDuration = await rewardEpochManager.getRewardEpochDurationRange(
    rewardEpochId,
    useExpectedEndIfNoSigningPolicyAfter
  );
  const rewardEpoch = await rewardEpochManager.getRewardEpochForVotingEpochId(rewardEpochDuration.startVotingRoundId);
  createRewardCalculationFolders(rewardEpochDuration, tempRewardEpochFolder, calculationFolder);
  return [rewardEpochDuration, rewardEpoch];
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
  prepareData = true,
  merge = true,
  serializeResults = false,
  useFastUpdatesData = false,
  logger: ILogger = console,
  calculationFolder = CALCULATIONS_FOLDER()
): Promise<IPartialRewardClaim[]> {
  let allRewardClaims: IPartialRewardClaim[] = [];

  if (prepareData) {
    await prepareDataForRewardCalculations(rewardEpochId, votingRoundId, randomGenerationBenchingWindow, dataManager);
  }

  let feedOffers = feedOffersParam;
  if (feedOffers === undefined) {
    feedOffers = deserializeGranulatedPartialOfferMap(rewardEpochId, votingRoundId, calculationFolder);
  }

  const data = deserializeDataForRewardCalculation(rewardEpochId, votingRoundId);
  const rewardEpochInfo = deserializeRewardEpochInfo(rewardEpochId);
  augmentDataForRewardCalculation(data, rewardEpochInfo);

  const medianCalculationMap = new Map<string, MedianCalculationResult>();
  for (const medianResult of data.medianCalculationResults) {
    medianCalculationMap.set(medianResult.feed.id, medianResult);
  }

  const delegationAddressToSigningAddress = new Map<string, string>();
  const signingAddressToDelegationAddress = new Map<string, string>();
  const signingAddressToIdentityAddress = new Map<string, string>();
  const signingAddressToFeeBips = new Map<string, number>();
  for (const voterWeight of data.dataForCalculations.votersWeightsMap.values()) {
    delegationAddressToSigningAddress.set(
      voterWeight.delegationAddress.toLowerCase(),
      voterWeight.signingAddress.toLowerCase()
    );
    signingAddressToDelegationAddress.set(
      voterWeight.signingAddress.toLowerCase(),
      voterWeight.delegationAddress.toLowerCase()
    );
    signingAddressToIdentityAddress.set(
      voterWeight.signingAddress.toLowerCase(),
      voterWeight.identityAddress.toLowerCase()
    );
    signingAddressToFeeBips.set(voterWeight.signingAddress.toLowerCase(), voterWeight.feeBIPS);
  }

  // Calculate reward claims for each feed offer
  for (const [feedId, offers] of feedOffers.entries()) {
    const medianResult = medianCalculationMap.get(feedId);
    if (medianResult === undefined) {
      // This should never happen
      throw new Error("Critical error: Median result is undefined");
    }
    // Calculate reward claims for each offer
    for (const offer of offers) {
      if (offer.shouldBeBurned) {
        const fullOfferBackClaim: IPartialRewardClaim = {
          votingRoundId,
          beneficiary: offer.claimBackAddress.toLowerCase(),
          amount: offer.amount,
          claimType: ClaimType.DIRECT,
          offerIndex: offer.offerIndex,
          // feedId: offer.feedId,  // should be undefined
          protocolTag: "" + FTSO2_PROTOCOL_ID,
          rewardTypeTag: RewardTypePrefix.FULL_OFFER_CLAIM_BACK,
          rewardDetailTag: "", // no additional tag
        };
        allRewardClaims.push(fullOfferBackClaim);
        continue;
      }
      // First each offer is split into three parts: median, signing and finalization
      const splitOffers = splitRewardOfferByTypes(offer);
      // From each partial offer in split calculate reward claims
      const medianRewardClaims = calculateMedianRewardClaims(
        splitOffers.medianRewardOffer,
        medianResult,
        data.dataForCalculations.votersWeightsMap!
      );

      // Extract voter signing addresses that are eligible for median reward
      const medianEligibleVoters = new Set(
        medianRewardClaims
          .filter(claim => claim.claimType === ClaimType.WNAT && claim.amount > 0n)
          .map(claim => {
            const delegationAddress = claim.beneficiary.toLowerCase();
            const signingAddress = delegationAddressToSigningAddress.get(delegationAddress);
            if (!signingAddress) {
              throw new Error(`Critical error: No signing address for delegation address: ${delegationAddress}`);
            }
            return signingAddress;
          })
      );

      const signingRewardClaims = calculateSigningRewards(splitOffers.signingRewardOffer, data, medianEligibleVoters);

      const finalizationRewardClaims = calculateFinalizationRewardClaims(
        splitOffers.finalizationRewardOffer,
        data,
        new Set(data.eligibleFinalizers),
        medianEligibleVoters
      );

      // Calculate penalties for reveal withdrawal offenders
      const revealWithdrawalPenalties = calculatePenalties(
        offer,
        PENALTY_FACTOR(),
        data.dataForCalculations.revealOffendersSet!,
        data.dataForCalculations.votersWeightsMap!,
        RewardTypePrefix.REVEAL_OFFENDERS
      );

      // Calculate penalties for reveal double signers
      // get signingAddresses of double signers
      const doubleSigners = calculateDoubleSigners(votingRoundId, FTSO2_PROTOCOL_ID, data.signaturesMap!);

      // convert signingAddresses to submitAddresses
      const doubleSignersSubmit = new Set(
        [...doubleSigners.keys()].map(signingAddress =>
          data.dataForCalculations.signingAddressToSubmitAddress.get(signingAddress)
        )
      );

      //distribute penalties
      const doubleSigningPenalties = calculatePenalties(
        offer,
        PENALTY_FACTOR(),
        doubleSignersSubmit,
        data.dataForCalculations.votersWeightsMap!,
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
  if (useFastUpdatesData) {
    const fuFeedOffers = deserializeGranulatedPartialOfferMapForFastUpdates(
      rewardEpochId,
      votingRoundId,
      calculationFolder
    );
    // feedId => FastUpdateFeedConfiguration
    const fuConfigurationMap = new Map<string, FastUpdateFeedConfiguration>();
    if (rewardEpochInfo.fuInflationRewardsOffered) {
      for (const feedConfiguration of rewardEpochInfo.fuInflationRewardsOffered.feedConfigurations) {
        fuConfigurationMap.set(feedConfiguration.feedId, feedConfiguration);
      }
    }
    const fuFeedValueMap = new Map<string, FUFeedValue>();
    if (
      rewardEpochInfo.fuInflationRewardsOffered.feedConfigurations.length > data.fastUpdatesData.feedValues.length
    ) {
      throw new Error("Critical error: Feed configurations contain more feeds then feed values");
    }
    // if new feeds are introduced during the voting round, they are ignored
    for (let i = 0; i < rewardEpochInfo.fuInflationRewardsOffered.feedConfigurations.length; i++) {
      const feedConfiguration = rewardEpochInfo.fuInflationRewardsOffered.feedConfigurations[i];
      const value = data.fastUpdatesData.feedValues[i];
      const decimals = data.fastUpdatesData.feedDecimals[i];
      fuFeedValueMap.set(feedConfiguration.feedId, {
        feedId: feedConfiguration.feedId,
        value,
        decimals,
      } as FUFeedValue);
    }
    const signingPolicyAddressesSubmitted = data.fastUpdatesData.signingPolicyAddressesSubmitted;
    for (const [feedId, offers] of fuFeedOffers.entries()) {
      const medianResult = medianCalculationMap.get(feedId);
      if (medianResult === undefined) {
        // This should never happen
        throw new Error("Critical error: Median result is undefined");
      }
      const feedValue = fuFeedValueMap.get(feedId);
      if (feedValue === undefined) {
        throw new Error(`Critical error: No feed value for feedId ${feedId}`);
      }
      const feedConfiguration = fuConfigurationMap.get(feedId);
      if (feedConfiguration === undefined) {
        throw new Error(`Critical error: No feed configuration for feedId ${feedId}`);
      }

      // Calculate reward claims for each offer
      for (const offer of offers) {
        const fastUpdatesClaims = calculateFastUpdatesClaims(
          offer,
          medianResult,
          feedValue,
          feedConfiguration,
          signingPolicyAddressesSubmitted,
          signingAddressToDelegationAddress,
          signingAddressToIdentityAddress,
          signingAddressToFeeBips,
          logger
        );
        allRewardClaims.push(...fastUpdatesClaims);
        if (merge) {
          allRewardClaims = RewardClaim.merge(allRewardClaims);
        }
      }
    }
  }
  if (serializeResults) {
    serializePartialClaimsForVotingRoundId(rewardEpochId, votingRoundId, allRewardClaims, calculationFolder);
  }
  return allRewardClaims;
}

export async function prepareDataForRewardCalculations(
  rewardEpochId: number,
  votingRoundId: number,
  randomGenerationBenchingWindow: number,
  dataManager: DataManager,
  calculationFolder = CALCULATIONS_FOLDER()
) {
  const rewardDataForCalculationResponse = await dataManager.getDataForRewardCalculation(
    votingRoundId,
    randomGenerationBenchingWindow
  );
  if (rewardDataForCalculationResponse.status !== DataAvailabilityStatus.OK) {
    throw new Error(`Data availability status is not OK: ${rewardDataForCalculationResponse.status}`);
  }

  const rewardDataForCalculations = rewardDataForCalculationResponse.data;
  const rewardEpoch = rewardDataForCalculations.dataForCalculations.rewardEpoch;

  // Calculate feed medians
  const medianResults: MedianCalculationResult[] = calculateMedianResults(
    rewardDataForCalculations.dataForCalculations
  );

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

  const randomData = calculateRandom(rewardDataForCalculations.dataForCalculations);
  const calculationResults = [
    MerkleTreeStructs.fromRandomCalculationResult(randomData),
    ...medianResults.map(result => MerkleTreeStructs.fromMedianCalculationResult(result)),
  ];
  serializeFeedValuesForVotingRoundId(rewardEpochId, votingRoundId, calculationResults, false, calculationFolder);
  serializeDataForRewardCalculation(
    rewardEpochId,
    rewardDataForCalculations,
    medianResults,
    randomData,
    [...eligibleFinalizationRewardVotersInGracePeriod],
    false,
    calculationFolder
  );
}

export async function prepareDataForRewardCalculationsForRange(
  rewardEpochId: number,
  firstVotingRoundId: number,
  lastVotingRoundId: number,
  randomGenerationBenchingWindow: number,
  dataManager: DataManagerForRewarding,
  useFastUpdatesData: boolean,
  tempRewardEpochFolder = false,
  calculationFolder = CALCULATIONS_FOLDER()
) {
  const rewardDataForCalculationResponse = await dataManager.getDataForRewardCalculationForVotingRoundRange(
    firstVotingRoundId,
    lastVotingRoundId,
    randomGenerationBenchingWindow,
    useFastUpdatesData
  );
  if (rewardDataForCalculationResponse.status !== DataAvailabilityStatus.OK) {
    throw new Error(`Data availability status is not OK: ${rewardDataForCalculationResponse.status}`);
  }

  for (let votingRoundId = firstVotingRoundId; votingRoundId <= lastVotingRoundId; votingRoundId++) {
    const rewardDataForCalculations = rewardDataForCalculationResponse.data[votingRoundId - firstVotingRoundId];
    const rewardEpoch = rewardDataForCalculations.dataForCalculations.rewardEpoch;

    // Calculate feed medians
    const medianResults: MedianCalculationResult[] = calculateMedianResults(
      rewardDataForCalculations.dataForCalculations
    );

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

    const randomData = calculateRandom(rewardDataForCalculations.dataForCalculations);
    const calculationResults = [
      MerkleTreeStructs.fromRandomCalculationResult(randomData),
      ...medianResults.map(result => MerkleTreeStructs.fromMedianCalculationResult(result)),
    ];
    serializeFeedValuesForVotingRoundId(
      rewardEpochId,
      votingRoundId,
      calculationResults,
      tempRewardEpochFolder,
      calculationFolder
    );
    serializeDataForRewardCalculation(
      rewardEpochId,
      rewardDataForCalculations,
      medianResults,
      randomData,
      [...eligibleFinalizationRewardVotersInGracePeriod],
      tempRewardEpochFolder,
      calculationFolder
    );
  }
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
