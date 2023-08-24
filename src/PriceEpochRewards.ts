import BN from "bn.js";
import {
  ClaimReward,
  ClaimRewardBody,
  MedianCalculationResult,
  RewardOffered,
  VoterRewarding,
  deepCopyClaim,
} from "./voting-interfaces";
import { feedId, toBN } from "./voting-utils";
import coder from "web3-eth-abi";
import utils from "web3-utils";

/**
 * Collection of utility methods used to calculate rewards for a given price epoch.
 */
export namespace PriceEpochRewards {
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
  ): ClaimReward[] {
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
      return [
        {
          merkleProof: [],
          claimRewardBody: {
            amount: offer.amount,
            weight: toBN(0), // indicates back claims
            currencyAddress: offer.currencyAddress,
            voterAddress: offer.remainderClaimer.toLowerCase(),
            epochId: priceEpoch,
          } as ClaimRewardBody,
        } as ClaimReward,
      ];
    }

    let rewardClaims: ClaimReward[] = [];
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
      let claimReward = {
        merkleProof: [],
        claimRewardBody: {
          amount: reward,
          weight: voterRecord.originalWeight,
          currencyAddress: offer.currencyAddress,
          voterAddress: voterRecord.voterAddress, // it is already lowercased
          epochId: priceEpoch,
          // offerTransactionId: offer.transactionId,
        } as ClaimRewardBody,
      } as ClaimReward;
      rewardClaims.push(claimReward);
    }
    // Assert
    if (!totalReward.eq(offer.amount)) {
      throw new Error(`Total reward for ${offer.currencyAddress} is not equal to the offer amount`);
    }

    return rewardClaims;
  }

  /**
   * Merges new claims with previous claims where previous claims are the cumulative
   * claims for all previous price epochs withing the same reward epoch.
   * Merging is done by the key (address, poolId).
   * This function can be used to accumulate claims for all slots in the same reward epoch
   * as well as to accumulate claims for all price epochs in the same reward epoch.
   * All claim objects in parameters remain unchanged and new objects are created.
   */
  export function mergeClaims(
    previousClaims: ClaimReward[],
    newClaims: ClaimReward[],
    enforcePriceEpochId?: number
  ): ClaimReward[] {
    // address => currency => ClaimReward
    let claimsMap = new Map<string, Map<string, ClaimReward>>();
    let previousClaimRewardMap = claimRewardsMap(previousClaims);
    let addedClaimsRewardMap = claimRewardsMap(newClaims);

    // init map from previous claims
    for (let claim of previousClaims) {
      let voterClaims = claimsMap.get(claim.claimRewardBody.voterAddress) || new Map<string, ClaimReward>();
      claimsMap.set(claim.claimRewardBody.voterAddress, voterClaims);
      if (voterClaims.has(claim.claimRewardBody.currencyAddress)) {
        throw new Error(
          `Duplicate claim for ${claim.claimRewardBody.voterAddress} and ${claim.claimRewardBody.currencyAddress}`
        );
      }
      voterClaims.set(claim.claimRewardBody.currencyAddress, deepCopyClaim(claim));
    }

    // merge with new claims by adding amounts
    for (let claim of newClaims) {
      let voterClaims = claimsMap.get(claim.claimRewardBody.voterAddress) || new Map<string, ClaimReward>();
      claimsMap.set(claim.claimRewardBody.voterAddress, voterClaims);
      let previousClaim = voterClaims.get(claim.claimRewardBody.currencyAddress);
      if (previousClaim) {
        previousClaim.claimRewardBody.amount = previousClaim.claimRewardBody.amount.add(claim.claimRewardBody.amount);
      } else {
        voterClaims.set(claim.claimRewardBody.currencyAddress, deepCopyClaim(claim));
      }
    }
    // unpacking the merged map to a list of claims
    let mergedClaims: ClaimReward[] = [];
    for (let voterClaims of claimsMap.values()) {
      for (let claim of voterClaims.values()) {
        if (enforcePriceEpochId !== undefined) {
          claim.claimRewardBody.epochId = enforcePriceEpochId;
        }
        if (claim.claimRewardBody.amount.gt(toBN(0))) {
          mergedClaims.push(claim);
        }
      }
    }
    let newClaimRewardMap = claimRewardsMap(mergedClaims);
    assertMergeCorrect(previousClaimRewardMap, newClaimRewardMap, addedClaimsRewardMap);
    return mergedClaims;
  }

  /**
   * Calculates claims for all slots in the price epoch.
   */
  export function claimsForSymbols(
    priceEpoch: number,
    calculationResults: MedianCalculationResult[],
    offersBySymbol: Map<string, RewardOffered[]>
  ): ClaimReward[] {
    let claims: ClaimReward[] = [];
    let offers: RewardOffered[] = [];
    for (let calculationResult of calculationResults) {
      let priceEpochOffers = offersBySymbol.get(feedId(calculationResult.feed))!;
      for (let offer of priceEpochOffers) {
        offers.push(offer);
        claims = mergeClaims(claims, calculateClaimsForOffer(priceEpoch, offer, calculationResult));
      }
    }
    assertOffersVsClaimsStats(offers, claims);
    return claims;
  }

  /**
   * Produces a map from currencyAddress to total reward amount for all claims
   */
  function claimRewardsMap(claims: ClaimReward[]) {
    let currencyAddressToTotalReward = new Map<string, BN>();
    for (let claim of claims) {
      let amount = currencyAddressToTotalReward.get(claim.claimRewardBody.currencyAddress) || toBN(0);
      currencyAddressToTotalReward.set(claim.claimRewardBody.currencyAddress, amount.add(claim.claimRewardBody.amount));
    }
    return currencyAddressToTotalReward;
  }

  /**
   * Checks that the amount are correct after merging claims, given the previous claims, new claims and the resulting (new) claims.
   */
  function assertMergeCorrect(
    previousClaimRewardMap: Map<string, BN>,
    newClaimRewardMap: Map<string, BN>,
    claimsAddedMap: Map<string, BN>
  ) {
    let allKeys = new Set<string>();
    previousClaimRewardMap.forEach((value, key) => allKeys.add(key));
    newClaimRewardMap.forEach((value, key) => allKeys.add(key));
    claimsAddedMap.forEach((value, key) => allKeys.add(key));
    for (let key of allKeys) {
      let previousAmount = previousClaimRewardMap.get(key) || toBN(0);
      let newAmount = newClaimRewardMap.get(key) || toBN(0);
      let claimsAddedAmount = claimsAddedMap.get(key) || toBN(0);
      let sum = previousAmount.add(claimsAddedAmount);
      if (!sum.eq(newAmount)) {
        throw new Error(`Sum of previous and added claims is not equal to new claims for ${key}`);
      }
    }
  }

  /**
   * Asserts that the sum of all offers is equal to the sum of all claims, for each currencyAddress
   */
  function assertOffersVsClaimsStats(offers: RewardOffered[], claims: ClaimReward[]) {
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
}
