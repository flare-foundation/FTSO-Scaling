import { DataAvailabilityStatus } from "../../../ftso-core/src/DataManager";
import { RewardEpochManager } from "../../../ftso-core/src/RewardEpochManager";
import { FTSO2_PROTOCOL_ID } from "../../../ftso-core/src/constants";
import { calculateMedianResults } from "../../../ftso-core/src/ftso-calculation/ftso-median";
import { RewardEpochDuration } from "../../../ftso-core/src/utils/RewardEpochDuration";
import { MedianCalculationResult } from "../../../ftso-core/src/voting-types";
import { ClaimType, IMergeableRewardClaim, IPartialRewardClaim, IRewardClaim, RewardClaim } from "../utils/RewardClaim";
import { RandomVoterSelector } from "./RandomVoterSelector";
import { RewardTypePrefix } from "./RewardTypePrefix";
import { calculateDoubleSigners } from "./reward-double-signers";
import { calculateFinalizationRewardClaims } from "./reward-finalization";
import { calculateMedianRewardClaims } from "./reward-median";
import { splitRewardOfferByTypes } from "./reward-offers";

import { existsSync, readFileSync } from "fs";
import { FastUpdateFeedConfiguration } from "../../../contracts/src/events/FUInflationRewardsOffered";
import { RewardEpoch } from "../../../ftso-core/src/RewardEpoch";
import { MerkleTreeStructs } from "../../../ftso-core/src/data/MerkleTreeStructs";
import { calculateRandom } from "../../../ftso-core/src/ftso-calculation/ftso-random";
import { ILogger } from "../../../ftso-core/src/utils/ILogger";
import { DataManagerForRewarding } from "../DataManagerForRewarding";
import {
  BURN_ADDRESS,
  CALCULATIONS_FOLDER,
  FDC_PROTOCOL_ID,
  FEEDS_RENAMING_FILE,
  FINALIZATION_VOTER_SELECTION_THRESHOLD_WEIGHT_BIPS,
  FTSO2_FAST_UPDATES_PROTOCOL_ID,
  PENALTY_FACTOR,
} from "../constants";
import { FUFeedValue } from "../data-calculation-interfaces";
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
  deserializeOffersForFDC,
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
import { calculateFdcPenalties } from "./fdc/reward-fdc-penalties";
import { calculateSigningRewardsForFDC, splitFDCRewardOfferByTypes } from "./fdc/reward-fdc-signing";
import { FastUpdatesRewardClaimType, calculateFastUpdatesClaims } from "./reward-fast-updates";
import { calculatePenalties } from "./reward-penalties";
import { calculateSigningRewards } from "./reward-signing";

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
  dataManager: DataManagerForRewarding,
  feedOffersParam: Map<string, IPartialRewardOfferForRound[]> | undefined,
  prepareData = true,
  merge = true,
  serializeResults = false,
  useFastUpdatesData = false,
  useFDCData = false,
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
        FTSO2_PROTOCOL_ID,
        data.firstSuccessfulFinalization,
        data.finalizations,
        data,
        new Set(data.eligibleFinalizers),
        medianEligibleVoters,
        RewardTypePrefix.FINALIZATION
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
  const network = process.env.NETWORK;
  const isContractChange = network == "coston" && votingRoundId == 779191;

  if (useFastUpdatesData && isContractChange) {
    const fuFeedOffers = deserializeGranulatedPartialOfferMapForFastUpdates(
      rewardEpochId,
      votingRoundId,
      calculationFolder
    );
    for (const [feedId, offers] of fuFeedOffers.entries()) {
      for (const offer of offers) {
        allRewardClaims.push({
          votingRoundId: offer.votingRoundId,
          beneficiary: BURN_ADDRESS,
          amount: offer.amount,
          claimType: ClaimType.DIRECT,
          offerIndex: 0,
          // feedId: offer.feedId,  // should be undefined
          protocolTag: "" + FTSO2_FAST_UPDATES_PROTOCOL_ID,
          rewardTypeTag: RewardTypePrefix.FULL_OFFER_CLAIM_BACK,
          rewardDetailTag: FastUpdatesRewardClaimType.CONTRACT_CHANGE,
        });
      }
    }
    if (merge) {
      allRewardClaims = RewardClaim.merge(allRewardClaims);
    }
  }
  if (useFastUpdatesData && !isContractChange) {
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
    if (rewardEpochInfo.fuInflationRewardsOffered.feedConfigurations.length > data.fastUpdatesData.feedValues.length) {
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
    // Renaming on Fast Updates happens after renaming for Ftso Scaling
    const feedRenamingMap: Map<string, string> = new Map<string, string>();
    if (existsSync(FEEDS_RENAMING_FILE())) {
      const feedRenamingData = JSON.parse(readFileSync(FEEDS_RENAMING_FILE(), "utf8"));
      for (const feed of feedRenamingData) {
        feedRenamingMap.set(feed.oldFeedId, feed.newFeedId);
      }
    }
    for (const [feedId, offers] of fuFeedOffers.entries()) {
      const medianResult =
        medianCalculationMap.get(feedId) == undefined
          ? medianCalculationMap.get(feedRenamingMap.get(feedId))
          : medianCalculationMap.get(feedId);
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

  if (useFDCData) {
    // read offers
    const offers = deserializeOffersForFDC(rewardEpochId, votingRoundId, calculationFolder);
    for (const offer of offers) {
      // We set the claim back address to burn address by default
      offer.claimBackAddress = BURN_ADDRESS.toLowerCase();
      if (offer.shouldBeBurned) {
        const fullOfferBackClaim: IPartialRewardClaim = {
          votingRoundId,
          beneficiary: offer.claimBackAddress,
          amount: offer.amount,
          claimType: ClaimType.DIRECT,
          // offerIndex: offer.offerIndex,
          protocolTag: "" + FDC_PROTOCOL_ID,
          rewardTypeTag: RewardTypePrefix.PARTIAL_FDC_OFFER_CLAIM_BACK,
          rewardDetailTag: "", // no additional tag
        };
        allRewardClaims.push(fullOfferBackClaim);
        continue;
      }
      const splitOffers = splitFDCRewardOfferByTypes(offer);

      const fdCFinalizationRewardClaims = calculateFinalizationRewardClaims(
        splitOffers.finalizationRewardOffer,
        FDC_PROTOCOL_ID,
        data.fdcData.firstSuccessfulFinalization,
        data.fdcData.finalizations,
        data,
        new Set(data.eligibleFinalizersFdc),
        new Set(data.eligibleFinalizersFdc),
        RewardTypePrefix.FDC_FINALIZATION
      );

      const fdcSigningRewardClaims = calculateSigningRewardsForFDC(
        splitOffers.signingRewardOffer,
        data,
        rewardEpochInfo
      );

      const fdcPenalties = calculateFdcPenalties(
        offer,
        rewardEpochInfo,
        data,
        PENALTY_FACTOR(),
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        data.dataForCalculations.votersWeightsMap!,
        RewardTypePrefix.FDC_OFFENDERS
      );

      allRewardClaims.push(...fdCFinalizationRewardClaims);
      allRewardClaims.push(...fdcSigningRewardClaims);
      allRewardClaims.push(...fdcPenalties);
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

export async function prepareDataForRewardCalculations(
  rewardEpochId: number,
  votingRoundId: number,
  randomGenerationBenchingWindow: number,
  dataManager: DataManagerForRewarding,
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
  const initialHashFdc = RandomVoterSelector.initialHashSeed(
    rewardEpoch.signingPolicy.seed,
    FDC_PROTOCOL_ID,
    votingRoundId
  );
  const eligibleFinalizationRewardVotersInGracePeriodFdc = new Set(
    randomVoterSelector.randomSelectThresholdWeightVoters(initialHashFdc)
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
    [...eligibleFinalizationRewardVotersInGracePeriodFdc],
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
  useFDCData: boolean,
  tempRewardEpochFolder = false,
  calculationFolder = CALCULATIONS_FOLDER()
) {
  const rewardDataForCalculationResponse = await dataManager.getDataForRewardCalculationForVotingRoundRange(
    firstVotingRoundId,
    lastVotingRoundId,
    randomGenerationBenchingWindow,
    useFastUpdatesData,
    useFDCData
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

    const initialHashFdc = RandomVoterSelector.initialHashSeed(
      rewardEpoch.signingPolicy.seed,
      FDC_PROTOCOL_ID,
      votingRoundId
    );
    const eligibleFinalizationRewardVotersInGracePeriodFdc = new Set(
      randomVoterSelector.randomSelectThresholdWeightVoters(initialHashFdc)
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
      [...eligibleFinalizationRewardVotersInGracePeriodFdc],
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
