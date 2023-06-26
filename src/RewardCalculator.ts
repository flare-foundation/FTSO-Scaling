import { toBN } from "../test-utils/utils/test-helpers";
import { FTSOClient } from "./FTSOClient";
import { MerkleTree } from "./MerkleTree";
import { RewardCalculatorForPriceEpoch } from "./RewardCalculatorForPriceEpoch";
import { ClaimReward, Feed, FeedValue, MedianCalculationResult, Offer } from "./voting-interfaces";
import { feedId, hashClaimReward } from "./voting-utils";

/**
 * Reward calculator for sequence of reward epochs.
 */
export class RewardCalculator {
  
  ////////////// Reward epoch settings //////////////
  // First rewarded price epoch
  firstRewardedPriceEpoch: number = 0;
  // Duration of the reward epoch in price epochs
  rewardEpochDurationInEpochs: number = 0;


  ////////////// Initial processing boundaries //////////////
  // First reward epoch to be processed
  initialRewardEpoch: number = 0;
  // First price epoch of the reward epoch 'initialRewardEpoch'.
  initialPriceEpoch: number = 0;

  ////////////// Progress counters //////////////
  // First price epoch of the next reward epoch in calculation. Used to determine when to move to the next reward epoch.
  firstPriceEpochInNextRewardEpoch: number = 0;
  // Next price epoch to be processed.
  currentUnprocessedPriceEpoch: number = 0;
  // Current reward epoch that is being processed.
  currentRewardEpoch: number = 0;
  // whether the calculator is initialized
  initialized = false;

  ////////////// Offer data //////////////
  // rewardEpochId => list of reward offers
  rewardOffers: Map<number, Offer[]> = new Map<number, Offer[]>();
  // rewardEpochId => feedId => list of reward offers
  // The offers in the same currency are accumulated
  rewardOffersBySymbol: Map<number, Map<string, Offer[]>> = new Map<number, Map<string, Offer[]>>();

  ////////////// Claim data //////////////
  // priceEpochId => list of claims
  priceEpochClaims: Map<number, ClaimReward[]> = new Map<number, ClaimReward[]>();
  // rewardEpochId => list of cumulative claims
  rewardEpochCumulativeRewards: Map<number, ClaimReward[]> = new Map<number, ClaimReward[]>();
  // rewardEpochId => canonical list of feeds in the reward epoch
  feedSequenceForRewardEpoch: Map<number, FeedValue[]> = new Map<number, FeedValue[]>();
  // rewardEpochId => feedId => index of the feed in the reward epoch
  indexForFeedInRewardEpoch: Map<number, Map<string, number>> = new Map<number, Map<string, number>>();

  ///////////// IQR and PCT weights //////////////
  // Should be nominators of fractions with the same denominator. Eg. if in BIPS with denominator 100, then 30 means 30%
  // The sum should be equal to the intended denominator (100 in the example).
  // IQR weight
  iqrShare: BN = toBN(0);
  // PCT weight
  pctShare: BN = toBN(0);

  client: FTSOClient;
  
  constructor(
    client: FTSOClient,
    firstRewardedPriceEpoch: number,
    rewardEpochDurationInEpochs: number,    
    initialRewardEpoch: number,
    iqrShare: BN,
    pctShare: BN
  ) {
    this.client = client;
    this.initialRewardEpoch = initialRewardEpoch;
    this.firstRewardedPriceEpoch = firstRewardedPriceEpoch;
    this.rewardEpochDurationInEpochs = rewardEpochDurationInEpochs;
    this.iqrShare = iqrShare;
    this.pctShare = pctShare;

    this.initialPriceEpoch = this.firstRewardedPriceEpoch + this.rewardEpochDurationInEpochs * this.initialRewardEpoch + 1; // ???

    // Progress counters initialization
    this.currentUnprocessedPriceEpoch = this.initialPriceEpoch;
    this.currentRewardEpoch = this.initialRewardEpoch;
    this.firstPriceEpochInNextRewardEpoch = this.initialPriceEpoch + this.rewardEpochDurationInEpochs;
    this.initialized = true;
  }

  /**
   * Sets the reward offers for the given reward epoch.
   * This can be done only once for each reward epoch.
   * @param rewardEpoch 
   * @param rewardOffers 
   */
  public setRewardOffers(rewardEpoch: number, rewardOffers: Offer[]) {
    if(this.rewardOffers.has(rewardEpoch)) {
      throw new Error(`Reward offers are already defined for reward epoch ${rewardEpoch}`);
    }
    this.rewardOffers.set(rewardEpoch, rewardOffers);
    this.buildSymbolToOffersMaps(rewardEpoch);
    this.buildSymbolSequence(rewardEpoch)
  }

  /**
   * Returns the reward epoch for the given price epoch.
   * @param priceEpoch 
   * @returns 
   */
  public rewardEpochIdForPriceEpoch(priceEpoch: number) {
    if(!this.initialized) {
      throw new Error("Reward calculator is not initialized");
    }
    return Math.floor((priceEpoch - this.firstRewardedPriceEpoch) / this.rewardEpochDurationInEpochs);
  }

  public getFeedSequenceForRewardEpoch(rewardEpoch: number): FeedValue[] {
    if(!this.initialized) {
      throw new Error("Reward calculator is not initialized");
    }
    let result = this.feedSequenceForRewardEpoch.get(rewardEpoch);
    if(result === undefined) {
      throw new Error(`Feed sequence is not defined for reward epoch ${rewardEpoch}`);
    }
    return result;
  }

  /**
   * Returns the first price epoch in the given reward epoch.
   * @param rewardEpoch 
   * @returns 
   */
  public firstPriceEpochInRewardEpoch(rewardEpoch: number) {
    if(!this.initialized) {
      throw new Error("Reward calculator is not initialized");
    }
    return this.firstRewardedPriceEpoch + this.rewardEpochDurationInEpochs * rewardEpoch;
  }
  /**
   * Returns customized reward offer with the share of the reward for the given price epoch.
   * @param priceEpoch 
   * @param offer 
   * @returns 
   */
  public rewardOfferForPriceEpoch(priceEpoch: number, offer: Offer): Offer {
    let rewardEpoch = this.rewardEpochIdForPriceEpoch(priceEpoch);
    let reward = offer.amount.div(toBN(this.rewardEpochDurationInEpochs));
    let remainder = offer.amount.mod(toBN(this.rewardEpochDurationInEpochs)).toNumber();
    let firstPriceEpochInRewardEpoch = this.firstPriceEpochInRewardEpoch(rewardEpoch);
    if(priceEpoch - firstPriceEpochInRewardEpoch < remainder) {
      reward = reward.add(toBN(1));
    }
    return {
      ...offer,
      priceEpochId: priceEpoch,
      amount: reward
    } as Offer;
  }

  public offersForPriceEpochAndSymbol(priceEpoch: number, feed: Feed): Offer[] {
    let rewardEpoch = this.rewardEpochIdForPriceEpoch(priceEpoch);
    let offersBySymbol = this.rewardOffersBySymbol.get(rewardEpoch);
    if(offersBySymbol === undefined) {
      throw new Error(`Reward offers are not defined for reward epoch ${rewardEpoch}`);
    }
    let offers = offersBySymbol.get(feedId(feed));
    if(offers === undefined) {
      throw new Error(`Reward offers are not defined for symbol ${feedId} in reward epoch ${rewardEpoch}`);
    }
    return offers.map(offer => this.rewardOfferForPriceEpoch(priceEpoch, offer));
  }

  /**
   * Rearranges the reward offers into a map of reward offers by symbol.
   * @param rewardEpoch 
   */
  private buildSymbolToOffersMaps(rewardEpoch: number) {
    if (this.rewardOffersBySymbol.has(rewardEpoch)) {
      throw new Error(`Reward offers are already defined for reward epoch ${rewardEpoch}`);
    }
    let rewardOffers = this.rewardOffers.get(rewardEpoch);
    if (rewardOffers === undefined) {
      throw new Error(`Reward offers are not defined for reward epoch ${rewardEpoch}`);
    }
    let result: Map<string, Offer[]> = new Map<string, Offer[]>();
    for (let offer of rewardOffers) {
      let offers = result.get(feedId(offer));
      if (offers === undefined) {
        offers = [];
        result.set(feedId(offer), offers);
      }
      offers.push(offer);
    }
    this.rewardOffersBySymbol.set(rewardEpoch, result);
  }
 
  private buildSymbolSequence(rewardEpoch: number) {
    if(this.feedSequenceForRewardEpoch.has(rewardEpoch)) {
      throw new Error(`Feed sequence is already defined for reward epoch ${rewardEpoch}`);
    }
    let rewardOffers = this.rewardOffers.get(rewardEpoch);
    if(rewardOffers === undefined) {
      throw new Error(`Reward offers are not defined for reward epoch ${rewardEpoch}`);
    }
    let feedValues = new Map<string, FeedValue>();
    for(let offer of rewardOffers) {
      let feedValue = feedValues.get(feedId(offer));
      if(feedValue === undefined) {
        feedValue = {
          feedId: feedId(offer),
          offerSymbol: offer.offerSymbol,
          quoteSymbol: offer.quoteSymbol,
          flrValue: toBN(0)        
        };
        feedValues.set(feedValue.feedId, feedValue);
      }
      feedValue.flrValue = feedValue.flrValue.add(offer.flrValue);
    }

    let feedSequence = Array.from(feedValues.values());
    feedSequence.sort((a: FeedValue, b: FeedValue) => {
      // sort decreasing by value and on same value increasing by feedId
      if(a.flrValue.lt(b.flrValue)) {
        return 1;
      } else if(a.flrValue.gt(b.flrValue)) {
        return -1;
      }
      if(feedId(a) < feedId(b)) {
        return -1;
      } else if(feedId(a) > feedId(b)) {
        return 1;
      }
      return 0;
    });
    this.feedSequenceForRewardEpoch.set(rewardEpoch, feedSequence);
    let indexForFeed = new Map<string, number>();
    for(let i = 0; i < feedSequence.length; i++) {
      indexForFeed.set(feedSequence[i].feedId, i);
    }
    this.indexForFeedInRewardEpoch.set(rewardEpoch, indexForFeed);
  }

  /**
   * Calculates the claims for the given price epoch.
   * These claims are then stored for each price epoch in the priceEpochClaims map.
   * During each reward epoch the claims are incrementally merged into cumulative claims for the reward epoch
   * which are stored in the rewardEpochCumulativeRewards map.
   * The function also detects the first price epoch in the next reward epoch and triggers
   * the calculation of the cumulative claims for the next reward epoch.
   * After the end of the reward epoch and the end of the first price epoch in the next reward epoch
   * the cumulative claims for the reward epoch are stored in the rewardEpochCumulativeRewards map.
   * 
   * The function must be called for sequential price epochs.
   * @param priceEpoch 
   * @param calculationResults 
   */
  calculateClaimsForPriceEpoch(priceEpoch: number, calculationResults: MedianCalculationResult[]) {
    if (priceEpoch !== this.currentUnprocessedPriceEpoch) {
      throw new Error(`Price epoch ${priceEpoch} is not the current unprocessed price epoch ${this.currentUnprocessedPriceEpoch}`);
    }
    let epochCalculator = new RewardCalculatorForPriceEpoch(priceEpoch, this);

    let claims = epochCalculator.claimsForSymbols(calculationResults, this.iqrShare, this.pctShare);
    // regular price epoch in the current reward epoch
    if (priceEpoch < this.firstPriceEpochInNextRewardEpoch) {
      if (priceEpoch === this.initialPriceEpoch) {
        this.priceEpochClaims.set(priceEpoch, claims);
        this.rewardEpochCumulativeRewards.set(this.currentRewardEpoch, claims);
      } else {
        let previousClaims = this.priceEpochClaims.get(priceEpoch - 1);
        if (previousClaims === undefined) {
          throw new Error("Previous claims are undefined");
        }
        let cumulativeClaims = epochCalculator.mergeClaims(previousClaims, claims);
        this.priceEpochClaims.set(priceEpoch, claims);
        this.rewardEpochCumulativeRewards.set(this.currentRewardEpoch, cumulativeClaims);
      }
    } else {
      // first price epoch in the next reward epoch
      let previousClaims = this.priceEpochClaims.get(priceEpoch - 1);
      if (previousClaims === undefined) {
        throw new Error("Previous claims are undefined");
      }
      let cumulativeClaims = epochCalculator.mergeClaims(previousClaims, claims);
      this.priceEpochClaims.set(priceEpoch, claims);
      // last (claiming) cumulative claim records
      this.rewardEpochCumulativeRewards.set(this.currentRewardEpoch, cumulativeClaims);
      this.currentRewardEpoch++;
      // initialize empty cumulative claims for the new reward epoch
      this.rewardEpochCumulativeRewards.set(this.currentRewardEpoch, []);
    }
  }

  getRewardMappingForPriceEpoch(priceEpoch: number): Map<string, ClaimReward> {
    if(!this.initialized) {
      throw new Error("Reward calculator is not initialized");
    }
    let result = this.rewardEpochCumulativeRewards.get(this.rewardEpochIdForPriceEpoch(priceEpoch));
    if(result === undefined) {
      throw new Error(`Reward mapping is not defined for price epoch ${priceEpoch}`);
    }
    let rewardMapping = new Map<string, ClaimReward>();
    for(let claim of result) {
      let address = claim.claimRewardBody.voterAddress;
      if(rewardMapping.has(address)) {
        throw new Error(`Duplicate claim for address ${address}`);
      }
      rewardMapping.set(address, claim);
    }
    return rewardMapping;
  }
  
  /**
   * Calculates the merkle tree for the given price epoch.
   * @param priceEpoch 
   * @returns 
   */
  merkleTreeForPriceEpoch(priceEpoch: number, abi: any) {
    if (priceEpoch < this.initialPriceEpoch) {
      throw new Error("Price epoch is before the initial price epoch");
    }
    if (priceEpoch >= this.currentUnprocessedPriceEpoch) {
      throw new Error("Price epoch is after the current unprocessed price epoch");
    }
    let rewardEpoch = Math.floor((priceEpoch - this.firstRewardedPriceEpoch) / this.rewardEpochDurationInEpochs);
    let claims = this.rewardEpochCumulativeRewards.get(rewardEpoch);
    if (claims === undefined) {
      throw new Error("Claims are undefined");
    }
    let rewardClaimHashes = claims.map((value) => hashClaimReward(value, abi));
    return new MerkleTree(rewardClaimHashes);
  }

}