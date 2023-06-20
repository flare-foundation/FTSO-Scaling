import { toBN } from "../test-utils/utils/test-helpers";
import { MerkleTree } from "./MerkleTree";
import { RewardCalculatorForPriceEpoch } from "./RewardCalculatorForPriceEpoch";
import { ClaimReward, MedianCalculationResult, Offer } from "./voting-interfaces";
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

  ///////////// IQR and PCT weights //////////////
  // Should be nominators of fractions with the same denominator. Eg. if in BIPS with denominator 100, then 30 means 30%
  // The sum should be equal to the intended denominator (100 in the example).
  // IQR weight
  iqrShare: BN = toBN(0);
  // PCT weight
  pctShare: BN = toBN(0);

  constructor(
    firstRewardedPriceEpoch: number,
    rewardEpochDurationInEpochs: number,    
    initialRewardEpoch: number,
    iqrShare: BN,
    pctShare: BN
  ) {
    this.initialRewardEpoch = initialRewardEpoch;
    this.firstRewardedPriceEpoch = firstRewardedPriceEpoch;
    this.rewardEpochDurationInEpochs = rewardEpochDurationInEpochs;
    this.iqrShare = iqrShare;
    this.pctShare = pctShare;
  }

  /**
   * Initializes the reward calculator.
   */
  public async initialize() {
    if(this.initialized) {
      return;
    }

    // Initial processing boundaries
    this.initialPriceEpoch = this.firstRewardedPriceEpoch + this.rewardEpochDurationInEpochs * this.initialRewardEpoch;

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
    this.buildRewardOffersForRewardEpoch(rewardEpoch);
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

  /**
   * Rearranges the reward offers into a map of reward offers by symbol.
   * @param rewardEpoch 
   */
  private buildRewardOffersForRewardEpoch(rewardEpoch: number) {
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
    // TODO: implement
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
  async calculateClaimsForPriceEpoch(priceEpoch: number, calculationResults: MedianCalculationResult[]) {
    if (priceEpoch !== this.currentUnprocessedPriceEpoch) {
      throw new Error("Price epoch is not the current unprocessed price epoch");
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
      // last (claiming) cummulative claim records
      this.rewardEpochCumulativeRewards.set(this.currentRewardEpoch, cumulativeClaims);
      this.currentRewardEpoch++;
      // initialize empty cummulative claims for the new reward epoch
      this.rewardEpochCumulativeRewards.set(this.currentRewardEpoch, []);
    }
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