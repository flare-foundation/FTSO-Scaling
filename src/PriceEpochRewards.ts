import BN from "bn.js";
import { RewardClaim, MedianCalculationResult, RewardOffered, VoterRewarding } from "./voting-interfaces";
import { feedId, toBN } from "./voting-utils";
import coder from "web3-eth-abi";
import utils from "web3-utils";
import { getLogger } from "./utils/logger";

/**
 * Collection of utility methods used for reward claim calculation.
 */
export namespace PriceEpochRewards {
  const logger = getLogger("PriceEpochRewards");
  /**
   * Pseudo random selection based on the hash of (slotId, priceEpoch, voterAddress).
   * Used to get deterministic randomization for border cases of IQR belt.
   */
  export function randomSelect(symbol: string, priceEpoch: number, voterAddress: string) {
    return toBN(
      utils.soliditySha3(coder.encodeParameters(["string", "uint256", "address"], [symbol, priceEpoch, voterAddress]))!
    )
      .mod(toBN(2))
      .eq(toBN(1));
  }

  /**
   * Given a slotId it calculates the claims for the slot from all active pools
   */
  function calculateClaimsForOffer(
    priceEpoch: number,
    offer: RewardOffered,
    calculationResult: MedianCalculationResult
  ): RewardClaim[] {
    // randomization for border cases
    // - a random for IQR belt is calculated from hash(priceEpochId, slotId, address)
    let voterRecords: VoterRewarding[] = [];
    // establish boundaries
    let lowIQR = calculationResult.data.quartile1Price;
    let highIQR = calculationResult.data.quartile3Price;

    // Elastic band limits
    let medianPrice = calculationResult.data.finalMedianPrice;
    let elasticBandDiff = toBN(medianPrice).mul(toBN(offer.elasticBandWidthPPM)).div(toBN(1000000));

    // NOTE: this can be negative
    let lowPCT = medianPrice - elasticBandDiff.toNumber();
    let highPCT = medianPrice + elasticBandDiff.toNumber();

    if (offer.priceEpochId !== priceEpoch) {
      throw new Error("Offer price epoch does not match the current price epoch");
    }

    // trusted provider lead
    let lowEligible = 0;
    let highEligible = 0;
    let pricesOfLeadProvidersThatVoted = [];
    if (offer.leadProviders.length > 0) {
      let leadProvidersSet = new Set<string>(offer.leadProviders.map(x => x.toLowerCase()));
      for (let i = 0; i < calculationResult.voters!.length; i++) {
        let voterAddress = calculationResult.voters![i];
        let price = calculationResult.prices![i];
        if (leadProvidersSet.has(voterAddress.toLowerCase())) {
          pricesOfLeadProvidersThatVoted.push(price);
        }
      }
      if (pricesOfLeadProvidersThatVoted.length > 0) {
        pricesOfLeadProvidersThatVoted.sort();
        let trustedMedianPrice = pricesOfLeadProvidersThatVoted[Math.floor(pricesOfLeadProvidersThatVoted.length / 2)];
        let eligibleRange = toBN(trustedMedianPrice).mul(toBN(offer.rewardBeltPPM)).div(toBN(1000000)).toNumber();
        lowEligible = Math.max(trustedMedianPrice - eligibleRange, 0);
        highEligible = trustedMedianPrice + eligibleRange;
      }
    }
    // assemble voter records
    for (let i = 0; i < calculationResult.voters!.length; i++) {
      let voterAddress = calculationResult.voters![i];
      let price = calculationResult.prices![i];
      voterRecords.push({
        voterAddress,
        weight: calculationResult.weights![i],
        originalWeight: calculationResult.weights![i],
        iqr:
          (price > lowIQR && price < highIQR) ||
          ((price === lowIQR || price === highIQR) && randomSelect(feedId(offer), priceEpoch, voterAddress)),
        pct: price > lowPCT && price < highPCT,
        eligible: pricesOfLeadProvidersThatVoted.length === 0 ? true : price >= lowEligible && price <= highEligible,
      } as VoterRewarding);
    }
    // Sort by voters' addresses since results have to be in the canonical order
    voterRecords.sort((a, b) => {
      if (a.voterAddress < b.voterAddress) {
        return -1;
      } else if (a.voterAddress > b.voterAddress) {
        return 1;
      }
      return 0;
    });

    // calculate iqr and pct sums
    let iqrSum: BN = toBN(0);
    let pctSum: BN = toBN(0);
    for (let voterRecord of voterRecords) {
      if (!voterRecord.eligible) {
        continue;
      }
      if (voterRecord.iqr) {
        iqrSum = iqrSum.add(voterRecord.weight);
      }
      if (voterRecord.pct) {
        pctSum = pctSum.add(voterRecord.weight);
      }
    }

    // calculate total rewarded weight
    let totalRewardedWeight = toBN(0);
    for (let voterRecord of voterRecords) {
      if (!voterRecord.eligible) {
        voterRecord.weight = toBN(0);
        continue;
      }
      let newWeight = toBN(0);
      if (pctSum.eq(toBN(0))) {
        if (voterRecord.iqr) {
          newWeight = voterRecord.weight;
        }
      } else {
        if (voterRecord.iqr) {
          newWeight = newWeight.add(offer.iqrSharePPM.mul(voterRecord.weight).mul(pctSum));
        }
        if (voterRecord.pct) {
          newWeight = newWeight.add(offer.pctSharePPM.mul(voterRecord.weight).mul(iqrSum));
        }
      }
      voterRecord.weight = newWeight;
      totalRewardedWeight = totalRewardedWeight.add(newWeight);
    }

    if (totalRewardedWeight.eq(toBN(0))) {
      // claim back to reward issuer
      const backClaim: RewardClaim = {
        isFixedClaim: true,
        amount: offer.amount,
        currencyAddress: offer.currencyAddress,
        beneficiary: offer.remainderClaimer.toLowerCase(),
        epochId: priceEpoch,
      };
      return [backClaim];
    }

    let rewardClaims: RewardClaim[] = [];
    let totalReward = toBN(0);
    let availableReward = offer.amount;
    let availableWeight = totalRewardedWeight;

    for (let voterRecord of voterRecords) {
      // double declining balance
      if (voterRecord.weight.eq(toBN(0))) {
        continue;
      }
      let reward = voterRecord.weight.mul(availableReward).div(availableWeight);
      availableReward = availableReward.sub(reward);
      availableWeight = availableWeight.sub(voterRecord.weight);

      totalReward = totalReward.add(reward);
      const rewardClaim: RewardClaim = {
        isFixedClaim: false,
        amount: reward,
        currencyAddress: offer.currencyAddress,
        beneficiary: voterRecord.voterAddress, // it is already lowercased
        epochId: priceEpoch,
      };
      rewardClaims.push(rewardClaim);
    }
    // Assert
    if (!totalReward.eq(offer.amount)) {
      throw new Error(`Total reward for ${offer.currencyAddress} is not equal to the offer amount`);
    }

    return rewardClaims;
  }

  /**
   * Merges claims for the same beneficiary, currency and type in the provided {@link unmergedClaims} list.
   */
  export function mergeClaims(mergePriceEpochId: number, unmergedClaims: readonly RewardClaim[]): RewardClaim[] {
    function mergeClaimsOfSameType(claims: RewardClaim[]): RewardClaim {
      const merged: RewardClaim = {
        ...claims[0],
        amount: claims.map(x => x.amount).reduce((a, b) => a.add(b), toBN(0)),
        epochId: mergePriceEpochId,
      };
      return merged;
    }

    const claimsByVoterAndCcy = new Map<string, Map<string, RewardClaim[]>>();
    for (const claim of unmergedClaims) {
      const voterClaimsByCcy = claimsByVoterAndCcy.get(claim.beneficiary) || new Map<string, RewardClaim[]>();
      claimsByVoterAndCcy.set(claim.beneficiary, voterClaimsByCcy);
      const claimsList = voterClaimsByCcy.get(claim.currencyAddress) || [];
      voterClaimsByCcy.set(claim.currencyAddress, claimsList);
      claimsList.push(claim);
    }

    const mergedClaims: RewardClaim[] = [];
    for (const voterClaimsByCcy of claimsByVoterAndCcy.values()) {
      for (const claims of voterClaimsByCcy.values()) {
        const fixedClaims: RewardClaim[] = [];
        const weightedClaims: RewardClaim[] = [];
        for (const claim of claims) {
          if (claim.isFixedClaim === true) {
            fixedClaims.push(claim);
          } else {
            weightedClaims.push(claim);
          }
        }
        if (fixedClaims.length > 0) mergedClaims.push(mergeClaimsOfSameType(fixedClaims));
        if (weightedClaims.length > 0) mergedClaims.push(mergeClaimsOfSameType(weightedClaims));
      }
    }

    return mergedClaims;
  }

  /**
   * Calculates claims for all slots in the price epoch.
   */
  export function claimsForSymbols(
    priceEpoch: number,
    calculationResults: MedianCalculationResult[],
    offers: RewardOffered[]
  ): RewardClaim[] {
    const offersBySymbol = getOffersBySymbol(offers);

    const claims: RewardClaim[] = [];
    for (const calculationResult of calculationResults) {
      const offersForSymbol = offersBySymbol.get(feedId(calculationResult.feed))!;
      for (const offer of offersForSymbol) {
        claims.push(...calculateClaimsForOffer(priceEpoch, offer, calculationResult));
      }
    }
    return claims;
  }

  function getOffersBySymbol(offers: RewardOffered[]) {
    const offersBySymbol = new Map<string, RewardOffered[]>();
    for (const offer of offers) {
      const offerFeedId = feedId(offer);
      const existing = offersBySymbol.get(offerFeedId) || [];
      existing.push(offer);
      offersBySymbol.set(offerFeedId, existing);
    }
    return offersBySymbol;
  }

  /**
   * Produces a map from currencyAddress to total reward amount for all claims
   */
  function claimRewardsMap(claims: RewardClaim[]) {
    let currencyAddressToTotalReward = new Map<string, BN>();
    for (let claim of claims) {
      let amount = currencyAddressToTotalReward.get(claim.currencyAddress) || toBN(0);
      currencyAddressToTotalReward.set(claim.currencyAddress, amount.add(claim.amount));
    }
    return currencyAddressToTotalReward;
  }

  /**
   * Asserts that the sum of all offers is equal to the sum of all claims, for each currencyAddress
   */
  export function assertOffersVsClaimsStats(offers: RewardOffered[], claims: RewardClaim[]) {
    let offersRewards = new Map<string, BN>();

    for (let offer of offers) {
      let amount = offersRewards.get(offer.currencyAddress) || toBN(0);
      offersRewards.set(offer.currencyAddress, amount.add(offer.amount));
    }
    let claimsRewards = claimRewardsMap(claims);
    if (offersRewards.size !== claimsRewards.size) {
      throw new Error("offersMap.size !== claimsMap.size");
    }
    for (let currencyAddress of offersRewards.keys()) {
      let offerAmount = offersRewards.get(currencyAddress)!;
      let claimAmount = claimsRewards.get(currencyAddress)!;
      if (!offerAmount.eq(claimAmount)) {
        throw new Error(`offerAmount ${offerAmount} != claimAmount ${claimAmount} for ${currencyAddress}`);
      }
    }
  }

  /**
   * Generates reward claims for the party that submitted the finalization transaction in the previous price epoch.
   */
  export function claimsForFinalizer(
    finalizationOffers: RewardOffered[],
    finalizerAddress: string,
    priceEpochId: number
  ) {
    const claims: RewardClaim[] = [];
    for (const offer of finalizationOffers) {
      const claim: RewardClaim = {
        isFixedClaim: true,
        amount: offer.amount,
        currencyAddress: offer.currencyAddress,
        beneficiary: finalizerAddress.toLowerCase(),
        epochId: priceEpochId,
      };
      claims.push(claim);
    }
    return claims;
  }

  /**
   * Generates reward claims for voters whose signatures were included the the previous epoch's finalization transaction.
   */
  export function claimsForSigners(
    signingOffers: RewardOffered[],
    signers: string[],
    priceEpochId: number
  ): RewardClaim[] {
    if (signers.length == 0) {
      logger.info(`No signers to be rewarded, generating back claims.`);
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
          epochId: priceEpochId,
        };
        signingClaims.push(claim);
      }
    }
    return signingClaims;
  }

  function generateBackClaims(signingOffers: RewardOffered[], priceEpochId: number): RewardClaim[] {
    console.log("Generating back claim of amount: ", signingOffers[0].amount.toString());
    const backClaims: RewardClaim[] = [];
    for (const offer of signingOffers) {
      const backClaim: RewardClaim = {
        isFixedClaim: true,
        amount: offer.amount,
        currencyAddress: offer.currencyAddress,
        beneficiary: offer.remainderClaimer.toLowerCase(),
        epochId: priceEpochId,
      };
      backClaims.push(backClaim);
    }
    return backClaims;
  }
}
