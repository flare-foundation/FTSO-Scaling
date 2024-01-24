import coder from "web3-eth-abi";
import utils from "web3-utils";
import { RewardEpoch, VoterWeights } from "./RewardEpoch";
import { IPartialRewardOffer, PartialRewardOffer } from "./utils/PartialRewardOffer";
import { ClaimType, IPartialRewardClaim, IRewardClaim, RewardClaim } from "./utils/RewardClaim";
import {
  Address,
  MedianCalculationResult
} from "./voting-types";
import { DataAvailabilityStatus, DataForRewardCalculation, DataManager } from "./DataManager";
import { calculateFeedMedians } from "./ftso-calculation-logic";
import { RewardEpochManager } from "./RewardEpochManager";
import { InflationRewardsOffered, RewardOffers } from "./events";
import { start } from "repl";


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
      const penalties = calculateRevealWithdrawalPenalties(rewardDataForCalculations);
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
  // TODO
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
  data: DataForRewardCalculation,
): IPartialRewardClaim[] {
  // TODO
  return [];
}


// /** Address to which we allocate penalised reward amounts. */
// const BURN_ADDRESS = ZERO_ADDRESS;
// /** 10% of total reward goes to the finalizer. */
// const FINALIZATION_BIPS = toBN(1_000);
// /** 10% of total reward goes to finalization signatures. */
// const SIGNING_BIPS = toBN(1_000);
// const TOTAL_BIPS = toBN(10_000);

// const MISSED_REVEAL_PENALIZATION: BN = toBN(10);

// const Web3Helper = new Web3();

// export class Penalty implements RewardClaim {
//   readonly isFixedClaim = true;
//   constructor(
//     readonly amount: BN,
//     readonly currencyAddress: string,
//     readonly beneficiary: string,
//     readonly priceEpochId: number
//   ) { }
// }

/**
 * Collection of utility methods used for reward claim calculation.
 */



// votingRoundId: number;
// // Ordered list of submission addresses matching the order in the signing policy
// orderedVotersSubmissionAddresses: Address[];
// // Reveals from eligible submission addresses that match to existing commits
// validEligibleReveals: Map<Address, IRevealData>;
// // Submission addresses of eligible voters that committed but withheld or provided wrong reveals in the voting round
// revealOffenders: Set<Address>;
// // Median voting weight
// voterMedianVotingWeights: Map<Address, bigint>;
// // Rewarding weights
// voterRewardingWeights: Map<Address, bigint>;
// // Feed order for the reward epoch of the voting round id
// feedOrder: Feed[];

/**
 * @param priceEpochId
 * @param commits
 * @param reveals
 * @param previousSignatures Make sure only signatures before finalization are included.
 * @param previousFinalizeData Make sure
 * @param rewardOffers
 * @param voterWeights
 * @returns
 */

/*
export async function calculateRewardsForVotingRoundId(
  votingRoundId: number,
  randomGenerationBenchingWindow: number,
  rewardEpoch: RewardEpoch,
  dataManager: DataManager
): Promise<IPartialRewardClaim[]> {

  const rewardDataForCalculationResponse = await dataManager.getDataForRewardCalculation(votingRoundId, randomGenerationBenchingWindow, rewardEpoch);
  if (rewardDataForCalculationResponse.status !== DataAvailabilityStatus.OK) {
    throw new Error(`Data availability status is not OK: ${rewardDataForCalculationResponse.status}`);
  }



  const rewardDataForCalculations = rewardDataForCalculationResponse.data;
  const medianResults: MedianCalculationResult[] = await calculateFeedMedians(rewardDataForCalculations.dataForCalculations);



  // const committedFailedReveal = revealResult.committedFailedReveal;

  // let rewardedSigners: string[] = [];

  // if (previousFinalizeData !== undefined) {
  //   // TODO: if previous finalize happened outside the price epoch window, we should not reward signers.
  //   rewardedSigners = await getSignersToReward(previousFinalizeData, previousSignatures, voterWeights);
  // }

  // return calculateClaimsForPriceEpoch(
  //   rewardOffers,
  //   priceEpochId,
  //   previousFinalizeData?.[0].from,
  //   rewardedSigners,
  //   medianResults,
  //   committedFailedReveal,
  //   voterWeights,
  //   epochs
  // );
}
*/
/**
 * We reward signers whose signatures were recorded in blocks preceding the finalization transaction block.
 * Note that the sender of a signature transaction may not match the author of that signature. We only want
 * to reward the author (signer).
 */
/*
async function getSignersToReward(
  finalizationData: [FinalizeData, number],
  epochSignatures: Map<string, [SignatureData, number]>,
  voterWeights: Map<string, BN>
): Promise<string[]> {
  const rewardedSigners = new Set<string>();
  const [data, finalizationTime] = finalizationData;

  for (const [signature, signatureTime] of epochSignatures.values()) {
    if (signatureTime > finalizationTime) continue; // Only reward signatures with block timestamp no greater than that of finalization
    const signer = recoverSigner(Web3Helper, data.merkleRoot, signature);
    // We check if the signer is registered for the _current_ reward epoch, the signature reward epoch might be one earlier.
    const signerWeight = voterWeights.get(signer);
    if (signerWeight && signerWeight.gt(toBN(0))) {
      rewardedSigners.add(signer);
    }
  }
  return Array.from(rewardedSigners);
}
*/




/*
export function calculateClaimsForPriceEpoch(
  rewardEpochOffers: RewardOffered[],
  priceEpochId: number,
  // an only be undefined during for the very first price epoch in FTSO.
  finalizerAddress: Address | undefined,
  signers: Address[],
  calculationResults: MedianCalculationResult[],
  committedFailedReveal: Address[],
  voterWeights: Map<Address, BN>,
  epochs: EpochSettings
): RewardClaim[] {
  const priceEpochOffers = rewardEpochOffers.map(offer => rewardOfferForPriceEpoch(priceEpochId, offer, epochs));

  const signingOffers: RewardOffered[] = [];
  const finalizationOffers: RewardOffered[] = [];
  const medianOffers: RewardOffered[] = [];

  const generatedClaims: RewardClaim[] = [];

  if (finalizerAddress === undefined) {
    medianOffers.push(...priceEpochOffers);
  } else {
    for (const offer of priceEpochOffers) {
      const forSigning = offer.amount.mul(FINALIZATION_BIPS).div(TOTAL_BIPS);
      const forFinalization = offer.amount.mul(SIGNING_BIPS).div(TOTAL_BIPS);
      const forMedian = offer.amount.sub(forSigning).sub(forFinalization);

      signingOffers.push({
        ...offer,
        amount: forSigning,
      } as RewardOffered);
      finalizationOffers.push({
        ...offer,
        amount: forFinalization,
      } as RewardOffered);
      medianOffers.push({
        ...offer,
        amount: forMedian,
      } as RewardOffered);
    }

    const finalizationClaims = claimsForFinalizer(finalizationOffers, finalizerAddress, priceEpochId);
    generatedClaims.push(...finalizationClaims);

    const signerClaims = claimsForSigners(signingOffers, signers, priceEpochId);
    generatedClaims.push(...signerClaims);
  }
  const resultClaims = claimsForSymbols(priceEpochId, calculationResults, medianOffers);
  generatedClaims.push(...resultClaims);

  assertOffersVsClaimsStats(priceEpochOffers, generatedClaims);

  if (committedFailedReveal.length > 0) {
    console.log(
      `Penalizing ${committedFailedReveal.length} voters for missed reveal: ${Array.from(
        committedFailedReveal.entries()
      )} `
    );
    const penalties = computePenalties(priceEpochId, committedFailedReveal, priceEpochOffers, voterWeights);
    generatedClaims.push(...penalties);
  }

  return generatedClaims;
}
*/

/*
export function generateProofsForClaims(allClaims: readonly RewardClaim[], mroot: string, claimer: Address) {
  const allHashes = allClaims.map(claim => hashRewardClaim(claim));
  const merkleTree = new MerkleTree(allHashes);
  if (merkleTree.root !== mroot) {
    throw new Error("Invalid Merkle root for reward claims");
  }

  const claimsWithProof: RewardClaimWithProof[] = [];
  for (let i = 0; i < allClaims.length; i++) {
    const claim = allClaims[i];
    if (claim.beneficiary.toLowerCase() === claimer.toLowerCase()) {
      claimsWithProof.push({
        merkleProof: getProof(i),
        body: claim,
      });
    }
  }

  return claimsWithProof;

  function getProof(i: number) {
    const proof = merkleTree.getProof(allHashes[i]);
    if (!proof) throw new Error(`No Merkle proof exists for claim hash ${allHashes[i]}`);
    return proof;
  }
}
*/
/**
 * Returns customized reward offer with the share of the reward for the given price epoch.
 */
/*
function rewardOfferForPriceEpoch(priceEpoch: number, offer: RewardOffered, epochs: EpochSettings): RewardOffered {
  const rewardEpoch = epochs.rewardEpochIdForPriceEpochId(priceEpoch);
  let reward = offer.amount.div(toBN(epochs.rewardEpochDurationInEpochs));
  const remainder = offer.amount.mod(toBN(epochs.rewardEpochDurationInEpochs)).toNumber();
  const firstPriceEpochInRewardEpoch = epochs.firstPriceEpochForRewardEpoch(rewardEpoch);
  if (priceEpoch - firstPriceEpochInRewardEpoch < remainder) {
    reward = reward.add(toBN(1));
  }
  const rewardOffer: RewardOffered = {
    ...offer,
    priceEpochId: priceEpoch,
    amount: reward,
  };
  return rewardOffer;
}

function computePenalties(
  priceEpochId: number,
  committedFailedReveal: Address[],
  priceEpochOffers: RewardOffered[],
  voterWeights: Map<Address, BN>
): Penalty[] {
  const penaltyClaims: Penalty[] = [];

  let totalWeight = toBN(0);
  for (const voterWeight of voterWeights.values()) totalWeight = totalWeight.add(voterWeight);

  for (const voter of committedFailedReveal) {
    const voterWeight = voterWeights.get(voter);
    if (voterWeight === undefined) throw new Error(`Illegal state: weight for voter ${voter} is undefined.`);

    for (const offer of priceEpochOffers) {
      const penaltyAmount = offer.amount.mul(voterWeight).div(totalWeight).mul(MISSED_REVEAL_PENALIZATION);
      const penalty = new Penalty(penaltyAmount, offer.currencyAddress, voter, priceEpochId);
      penaltyClaims.push(penalty);
    }
  }

  return penaltyClaims;
}
*/





/*
function applyPenalty(claim: RewardClaim, penalty: RewardClaim): [RewardClaim | undefined, RewardClaim | undefined] {
  let penaltyAmountLeft: BN;
  let claimAmountLeft: BN;

  if (claim.amount.gte(penalty.amount)) {
    claimAmountLeft = claim.amount.sub(penalty.amount);
    penaltyAmountLeft = toBN(0);
  } else {
    claimAmountLeft = toBN(0);
    penaltyAmountLeft = penalty.amount.sub(claim.amount);
  }

  let resultClaim: RewardClaim | undefined;
  if (claimAmountLeft.gtn(0)) {
    resultClaim = {
      ...claim,
      amount: claimAmountLeft,
    };
  } else {
    resultClaim = undefined;
  }

  let resultPenalty: RewardClaim | undefined;
  if (penaltyAmountLeft.gtn(0)) {
    resultPenalty = {
      ...penalty,
      amount: penaltyAmountLeft,
    };
  } else resultPenalty = undefined;

  return [resultClaim, resultPenalty];
}
*/

/**
 * Calculates claims for all slots in the price epoch.
 */
/*
function claimsForSymbols(
  priceEpoch: number,
  calculationResults: MedianCalculationResult[],
  offers: RewardOffered[]
): RewardClaim[] {
  const offersBySymbol = getOffersBySymbol(offers);

  const claims: RewardClaim[] = [];
  for (const calculationResult of calculationResults) {
    const offersForSymbol = offersBySymbol.get(calculationResult.feed.name)!;
    for (const offer of offersForSymbol) {
      claims.push(...calculateClaimsForOffer(priceEpoch, offer, calculationResult));
    }
  }
  return claims;
}

function getOffersBySymbol(offers: RewardOffered[]) {
  const offersBySymbol = new Map<string, RewardOffered[]>();
  for (const offer of offers) {
    const offerFeedId = offer.name;
    const existing = offersBySymbol.get(offerFeedId) || [];
    existing.push(offer);
    offersBySymbol.set(offerFeedId, existing);
  }
  return offersBySymbol;
}
*/
/**
 * Produces a map from currencyAddress to total reward amount for all claims
 */
/*
function claimRewardsMap(claims: RewardClaim[]) {
  const currencyAddressToTotalReward = new Map<string, BN>();
  for (const claim of claims) {
    const amount = currencyAddressToTotalReward.get(claim.currencyAddress) || toBN(0);
    currencyAddressToTotalReward.set(claim.currencyAddress, amount.add(claim.amount));
  }
  return currencyAddressToTotalReward;
}
*/
/**
 * Asserts that the sum of all offers is equal to the sum of all claims, for each currencyAddress
 */
/*
function assertOffersVsClaimsStats(offers: RewardOffered[], claims: RewardClaim[]) {
  const offersRewards = new Map<string, BN>();

  for (const offer of offers) {
    const amount = offersRewards.get(offer.currencyAddress) || toBN(0);
    offersRewards.set(offer.currencyAddress, amount.add(offer.amount));
  }
  const claimsRewards = claimRewardsMap(claims);
  if (offersRewards.size !== claimsRewards.size) {
    throw new Error("offersMap.size !== claimsMap.size");
  }
  for (const currencyAddress of offersRewards.keys()) {
    const offerAmount = offersRewards.get(currencyAddress)!;
    const claimAmount = claimsRewards.get(currencyAddress)!;
    if (!offerAmount.eq(claimAmount)) {
      throw new Error(`offerAmount ${offerAmount} != claimAmount ${claimAmount} for ${currencyAddress}`);
    }
  }
}
*/
/**
 * Generates reward claims for the party that submitted the finalization transaction in the previous price epoch.
 */
/*
function claimsForFinalizer(finalizationOffers: RewardOffered[], finalizerAddress: Address, priceEpochId: number) {
  const claims: RewardClaim[] = [];
  for (const offer of finalizationOffers) {
    const claim: RewardClaim = {
      isFixedClaim: true,
      amount: offer.amount,
      currencyAddress: offer.currencyAddress,
      beneficiary: finalizerAddress.toLowerCase(),
      priceEpochId: priceEpochId,
    };
    claims.push(claim);
  }
  return claims;
}
*/
/**
 * Generates reward claims for voters whose signatures were included the the previous epoch's finalization transaction.
 */
/*
function claimsForSigners(signingOffers: RewardOffered[], signers: Address[], priceEpochId: number): RewardClaim[] {
  if (signers.length == 0) {
    return generateBackClaims(signingOffers, priceEpochId);
  }
  const signingClaims = [];
  for (const offer of signingOffers) {
    const rewardShare = offer.amount.div(toBN(signers.length));
    for (let i = 0; i < signers.length; i++) {
      let reward = rewardShare;
      if (i === 0) {
        reward = reward.add(offer.amount.mod(toBN(signers.length)));
      }
      const claim: RewardClaim = {
        isFixedClaim: true,
        amount: reward,
        currencyAddress: offer.currencyAddress,
        beneficiary: signers[i].toLowerCase(),
        priceEpochId: priceEpochId,
      };
      signingClaims.push(claim);
    }
  }
  return signingClaims;
}

function generateBackClaims(signingOffers: RewardOffered[], priceEpochId: number): RewardClaim[] {
  const backClaims: RewardClaim[] = [];
  for (const offer of signingOffers) {
    const backClaim: RewardClaim = {
      isFixedClaim: true,
      amount: offer.amount,
      currencyAddress: offer.currencyAddress,
      beneficiary: offer.remainderClaimer.toLowerCase(),
      priceEpochId: priceEpochId,
    };
    backClaims.push(backClaim);
  }
  return backClaims;
}
*/
/**
 * Pseudo random selection based on the hash of (slotId, priceEpoch, voterAddress).
 * Used to get deterministic randomization for border cases of IQR belt.
 */
