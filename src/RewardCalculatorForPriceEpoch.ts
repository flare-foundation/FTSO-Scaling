import BN from "bn.js";
import Web3 from "web3";
import { toBN } from "../test-utils/utils/test-helpers";
import { RewardCalculator } from "./RewardCalculator";
import { ClaimReward, ClaimRewardBody, MedianCalculationResult, RewardOffered, VoterWithWeight, deepCopyClaim } from "./voting-interfaces";
import { feedId } from "./voting-utils";


/**
 * This class is used to calculate rewards for a given price epoch.
 */
export class RewardCalculatorForPriceEpoch {
  priceEpoch: number = 0;
  rewardCalculator!: RewardCalculator;
  web3: Web3 = new Web3();

  constructor(
    priceEpoch: number,
    rewardCalculator: RewardCalculator
  ) {
    this.priceEpoch = priceEpoch;
    this.rewardCalculator = rewardCalculator;
  }

  /**
   * Returns the reward epoch for the price epoch.
   */
  get rewardEpochId() {
    return this.rewardCalculator.rewardEpochIdForPriceEpoch(this.priceEpoch);
  }

  /**
   * Pseudo random selection based on the hash of (slotId, priceEpoch, voterAddress).
   * Used to get deterministic randomization for border cases of IQR belt. 
   * @param slotId 
   * @param priceEpoch 
   * @param voterAddress 
   * @returns 
   */
  randomSelect(symbol: string, priceEpoch: number, voterAddress: string) {
    return toBN(
      this.web3.utils.soliditySha3(
        this.web3.eth.abi.encodeParameters(
          ["string", "uint256", "address"],
          [symbol, priceEpoch, voterAddress]
        )
      )!
    ).mod(toBN(2)).eq(toBN(1));
  }

  /**
   * Given a slotId it calculates the claims for the slot from all active pools
   * @param slotId 
   * @param calculationResult 
   * @param iqrShare 
   * @param pctShare 
   * @returns 
   */
  calculateClaimsForOffer(offer: RewardOffered, calculationResult: MedianCalculationResult, iqrShare: BN, pctShare: BN): ClaimReward[] {
    // randomization for border cases
    // - a random for IQR belt is calculated from hash(priceEpochId, slotId, address)
    let voterRecords: VoterWithWeight[] = [];
    // establish boundaries
    let lowIQR = calculationResult.data.quartile1Price;
    let highIQR = calculationResult.data.quartile3Price;
    let lowPCT = calculationResult.data.lowElasticBandPrice;
    let highPCT = calculationResult.data.highElasticBandPrice;

    if (offer.priceEpochId !== this.priceEpoch) {
      throw new Error("Offer price epoch does not match the current price epoch");
    }
    // assemble voter records
    for (let i = 0; i < calculationResult.voters!.length; i++) {
      let voterAddress = calculationResult.voters![i];
      let price = calculationResult.prices![i];
      voterRecords.push({
        voterAddress,
        weight: calculationResult.weights![i],
        iqr: (price > lowIQR && price < highIQR) || ((price === lowIQR || price === highIQR) && this.randomSelect(feedId(offer), this.priceEpoch, voterAddress)),
        pct: price > lowPCT && price < highPCT
      });
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
      let newWeight = toBN(0);
      if (pctSum.eq(toBN(0))) {
        if (voterRecord.iqr) {
          newWeight = voterRecord.weight;
        }
      } else {
        if (voterRecord.iqr) {
          newWeight = newWeight.add(iqrShare.mul(voterRecord.weight).mul(pctSum));
        }
        if (voterRecord.pct) {
          newWeight = newWeight.add(pctShare.mul(voterRecord.weight).mul(iqrSum));
        }
      }
      voterRecord.weight = newWeight;
      totalRewardedWeight = totalRewardedWeight.add(newWeight);
    }

    if (totalRewardedWeight.eq(toBN(0))) {
      // TODO: make a claim back to reward issuer
      return [];
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
          currencyAddress: offer.currencyAddress,
          voterAddress: voterRecord.voterAddress,  // it is already lowercased
          epochId: this.priceEpoch,
          // offerTransactionId: offer.transactionId,
        } as ClaimRewardBody
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
   * @param previousClaims 
   * @param newClaims 
   * @returns 
   */
  mergeClaims(previousClaims: ClaimReward[], newClaims: ClaimReward[], enforcePriceEpochId?: number): ClaimReward[] {
    // address => currency => ClaimReward
    let claimsMap = new Map<string, Map<string, ClaimReward>>();
    let previousClaimRewardMap = this.claimRewardsMap(previousClaims);
    let addedClaimsRewardMap = this.claimRewardsMap(newClaims);

    // init map from previous claims
    for (let claim of previousClaims) {
      let voterClaims = claimsMap.get(claim.claimRewardBody.voterAddress) || new Map<string, ClaimReward>();
      claimsMap.set(claim.claimRewardBody.voterAddress, voterClaims);
      if (voterClaims.has(claim.claimRewardBody.currencyAddress)) {
        throw new Error(`Duplicate claim for ${claim.claimRewardBody.voterAddress} and ${claim.claimRewardBody.currencyAddress}`);
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
    let newClaimRewardMap = this.claimRewardsMap(mergedClaims);
    this.assertMergeCorrect(previousClaimRewardMap, newClaimRewardMap, addedClaimsRewardMap);
    return mergedClaims;
  }

  /**
   * Calculates claims for all slots in the price epoch.
   * @param calculationResults 
   * @param iqrShare 
   * @param pctShare 
   * @returns 
   */
  claimsForSymbols(calculationResults: MedianCalculationResult[], iqrShare: BN, pctShare: BN): ClaimReward[] {
    let claims: ClaimReward[] = [];
    let offers: RewardOffered[] = [];
    for (let calculationResult of calculationResults) {
      let priceEpochOffers = this.rewardCalculator.offersForPriceEpochAndSymbol(this.priceEpoch, calculationResult.feed);
      for (let offer of priceEpochOffers) {
        offers.push(offer);
        claims = this.mergeClaims(claims, this.calculateClaimsForOffer(offer, calculationResult, iqrShare, pctShare));
      }
    }
    this.assertOffersVsClaimsStats(offers, claims);
    return claims;
  }

  /**
   * Produces a map from currencyAddress to total reward amount for all claims
   * @param claims 
   * @returns 
   */
  private claimRewardsMap(claims: ClaimReward[]) {
    let currencyAddressToTotalReward = new Map<string, BN>();
    for (let claim of claims) {
      let amount = currencyAddressToTotalReward.get(claim.claimRewardBody.currencyAddress) || toBN(0);
      currencyAddressToTotalReward.set(claim.claimRewardBody.currencyAddress, amount.add(claim.claimRewardBody.amount));
    }
    return currencyAddressToTotalReward;
  }

  /**
   * Checks that the amount are correct after merging claims, given the previous claims, new claims and the resulting (new) claims.
   * @param previousClaimRewardMap 
   * @param newClaimRewardMap 
   * @param claimsAddedMap 
   */
  private assertMergeCorrect(previousClaimRewardMap: Map<string, BN>, newClaimRewardMap: Map<string, BN>, claimsAddedMap: Map<string, BN>) {
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
   * @param offers 
   * @param claims 
   */
  private assertOffersVsClaimsStats(offers: RewardOffered[], claims: ClaimReward[]) {
    let offersRewards = new Map<string, BN>();

    for (let offer of offers) {
      let amount = offersRewards.get(offer.currencyAddress) || toBN(0);
      offersRewards.set(offer.currencyAddress, amount.add(offer.amount));
    }
    let claimsRewards = this.claimRewardsMap(claims);
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
