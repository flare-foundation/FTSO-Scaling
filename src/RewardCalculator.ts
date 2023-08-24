import { EpochSettings } from "./EpochSettings";
import { PriceEpochRewards } from "./PriceEpochRewards";
import { ClaimReward, Feed, FeedValue, MedianCalculationResult, RewardOffered } from "./voting-interfaces";
import { feedId, toBN } from "./voting-utils";

/**
 * Reward calculator for sequence of reward epochs.
 * In essence it is initialized with the start reward epoch and the corresponding initial price epoch.
 * Then it gets filled in with the reward offers for each reward epoch and the calculation results in order of
 * price epochs. In the process all the claims are calculated and stored for each price epoch and reward epoch.
 */
export class RewardCalculator {
  ////////////// Initial processing boundaries //////////////
  // First price epoch of the reward epoch 'initialRewardEpoch'.
  private initialPriceEpoch: number = 0;

  ////////////// Progress counters //////////////
  // First price epoch of the next reward epoch in calculation. Used to determine when to move to the next reward epoch.
  private firstPriceEpochInNextRewardEpoch: number = 0;
  // Next price epoch to be processed.
  private currentUnprocessedPriceEpoch: number = 0;
  // Current reward epoch that is being processed.
  private currentRewardEpoch: number = 0;

  ////////////// Offer data //////////////
  // rewardEpochId => list of reward offers
  private readonly rewardOffers = new Map<number, RewardOffered[]>();
  // rewardEpochId => feedId => list of reward offers
  // The offers in the same currency are accumulated
  readonly rewardOffersBySymbol = new Map<number, Map<string, RewardOffered[]>>();

  ////////////// Claim data //////////////
  // rewardEpochId => list of cumulative claims
  private readonly rewardEpochCumulativeRewards = new Map<number, ClaimReward[]>();
  // rewardEpochId => canonical list of feeds in the reward epoch
  private readonly feedSequenceForRewardEpoch = new Map<number, FeedValue[]>();

  constructor(private readonly epochs: EpochSettings, initialRewardEpoch: number) {
    this.initialPriceEpoch = epochs.firstRewardedPriceEpoch + epochs.rewardEpochDurationInEpochs * initialRewardEpoch;
    // Progress counters initialization
    this.currentUnprocessedPriceEpoch = this.initialPriceEpoch;
    this.currentRewardEpoch = initialRewardEpoch;
    this.firstPriceEpochInNextRewardEpoch = this.initialPriceEpoch + epochs.rewardEpochDurationInEpochs;
  }

  /**
   * Sets the reward offers for the given reward epoch.
   * This can be done only once for each reward epoch.
   */
  public setRewardOffers(rewardEpoch: number, rewardOffers: RewardOffered[]) {
    if (this.rewardOffers.has(rewardEpoch)) {
      throw new Error(`Reward offers are already defined for reward epoch ${rewardEpoch}`);
    }
    this.rewardOffers.set(rewardEpoch, rewardOffers);
    this.buildSymbolToOffersMaps(rewardEpoch);
    this.calculateSymbolSequenceForRewardEpoch(rewardEpoch);
  }

  /**
   * Returns the feed sequence for the given reward epoch.
   * The sequence defines the order of feeds in the price vectors for the reward epoch.
   */
  public getFeedSequenceForRewardEpoch(rewardEpoch: number): FeedValue[] {
    let result = this.feedSequenceForRewardEpoch.get(rewardEpoch);
    if (result === undefined) {
      throw new Error(`Feed sequence is not defined for reward epoch ${rewardEpoch}`);
    }
    return result;
  }

  /**
   * Returns customized reward offer with the share of the reward for the given price epoch.
   */
  public rewardOfferForPriceEpoch(priceEpoch: number, offer: RewardOffered): RewardOffered {
    let rewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(priceEpoch);
    let reward = offer.amount.div(toBN(this.epochs.rewardEpochDurationInEpochs));
    let remainder = offer.amount.mod(toBN(this.epochs.rewardEpochDurationInEpochs)).toNumber();
    let firstPriceEpochInRewardEpoch = this.epochs.firstPriceEpochForRewardEpoch(rewardEpoch);
    if (priceEpoch - firstPriceEpochInRewardEpoch < remainder) {
      reward = reward.add(toBN(1));
    }
    return {
      ...offer,
      priceEpochId: priceEpoch,
      amount: reward,
    } as RewardOffered;
  }

  /**
   * Returns the list of reward offers for the given price epoch and feed.
   * The offers are customized for the given price epoch, containing the share of
   * the reward for the given price epoch.
   */
  public offersForPriceEpochAndSymbol(priceEpochId: number, feeds: Feed[]): Map<string, RewardOffered[]> {
    const priceEpochOffersBySymbol = new Map<string, RewardOffered[]>();
    const rewardEpochId = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);
    const rewardEpochOffersBySymbol = this.rewardOffersBySymbol.get(rewardEpochId);
    if (rewardEpochOffersBySymbol === undefined) {
      throw new Error(`Reward offers are not defined for reward epoch ${rewardEpochId}`);
    }
    for (const feed of feeds) {
      const offers = rewardEpochOffersBySymbol.get(feedId(feed));
      if (offers === undefined) {
        throw new Error(`Reward offers are not defined for symbol ${feedId(feed)} in reward epoch ${rewardEpochId}`);
      }
      priceEpochOffersBySymbol.set(
        feedId(feed),
        offers.map(offer => this.rewardOfferForPriceEpoch(priceEpochId, offer))
      );
    }
    return priceEpochOffersBySymbol;
  }

  /**
   * Rearranges the reward offers into a map of reward offers by symbol.
   */
  private buildSymbolToOffersMaps(rewardEpoch: number) {
    if (this.rewardOffersBySymbol.has(rewardEpoch)) {
      throw new Error(`Reward offers are already defined for reward epoch ${rewardEpoch}`);
    }
    let rewardOffers = this.rewardOffers.get(rewardEpoch);
    if (rewardOffers === undefined) {
      throw new Error(`Reward offers are not defined for reward epoch ${rewardEpoch}`);
    }
    let result: Map<string, RewardOffered[]> = new Map<string, RewardOffered[]>();
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

  /**
   * Calculates the sequence of feeds for the given reward epoch.
   * The sequence is sorted by the value of the feed in the reward epoch in decreasing order.
   * In case of equal values the feedId is used to sort in increasing order.
   * The sequence defines positions of the feeds in the price vectors for the reward epoch.
   * @param rewardEpoch
   */
  private calculateSymbolSequenceForRewardEpoch(rewardEpoch: number) {
    if (this.feedSequenceForRewardEpoch.has(rewardEpoch)) {
      throw new Error(`Feed sequence is already defined for reward epoch ${rewardEpoch}`);
    }
    let rewardOffers = this.rewardOffers.get(rewardEpoch);
    if (rewardOffers === undefined) {
      throw new Error(`Reward offers are not defined for reward epoch ${rewardEpoch}`);
    }
    let feedValues = new Map<string, FeedValue>();
    for (let offer of rewardOffers) {
      let feedValue = feedValues.get(feedId(offer));
      if (feedValue === undefined) {
        feedValue = {
          feedId: feedId(offer),
          offerSymbol: offer.offerSymbol,
          quoteSymbol: offer.quoteSymbol,
          flrValue: toBN(0),
        };
        feedValues.set(feedValue.feedId, feedValue);
      }
      feedValue.flrValue = feedValue.flrValue.add(offer.flrValue);
    }

    let feedSequence = Array.from(feedValues.values());
    feedSequence.sort((a: FeedValue, b: FeedValue) => {
      // sort decreasing by value and on same value increasing by feedId
      if (a.flrValue.lt(b.flrValue)) {
        return 1;
      } else if (a.flrValue.gt(b.flrValue)) {
        return -1;
      }
      if (feedId(a) < feedId(b)) {
        return -1;
      } else if (feedId(a) > feedId(b)) {
        return 1;
      }
      return 0;
    });
    this.feedSequenceForRewardEpoch.set(rewardEpoch, feedSequence);
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
   */
  public calculateClaimsForPriceEpoch(priceEpochId: number, calculationResults: MedianCalculationResult[]) {
    if (priceEpochId !== this.currentUnprocessedPriceEpoch) {
      throw new Error(
        `Price epoch ${priceEpochId} is not the current unprocessed price epoch ${this.currentUnprocessedPriceEpoch}`
      );
    }
    let offersBySymbol = this.offersForPriceEpochAndSymbol(
      priceEpochId,
      calculationResults.map(result => result.feed)
    );
    let claims = PriceEpochRewards.claimsForSymbols(priceEpochId, calculationResults, offersBySymbol);
    // regular price epoch in the current reward epoch
    if (priceEpochId < this.firstPriceEpochInNextRewardEpoch - 1) {
      this.onRegularPriceEpoch(priceEpochId, claims);
    } else {
      // we are in the last price epoch of the current reward epoch
      // the reward epoch is not yet shifted to the next reward epoch, matching the price epoch
      this.onLastPriceEpoch(claims, priceEpochId);
    }
    this.currentUnprocessedPriceEpoch++;
  }

  private onRegularPriceEpoch(priceEpochId: number, claims: ClaimReward[]) {
    if (priceEpochId === this.initialPriceEpoch) {
      this.rewardEpochCumulativeRewards.set(this.currentRewardEpoch, claims);
    } else {
      const previousClaims = this.rewardEpochCumulativeRewards.get(this.currentRewardEpoch);
      if (previousClaims === undefined) {
        throw new Error("Previous claims are undefined");
      }
      const cumulativeClaims = PriceEpochRewards.mergeClaims(previousClaims, claims, priceEpochId);
      this.rewardEpochCumulativeRewards.set(this.currentRewardEpoch, cumulativeClaims);
    }
  }

  private onLastPriceEpoch(claims: ClaimReward[], priceEpochId: number) {
    let previousClaims = this.rewardEpochCumulativeRewards.get(this.currentRewardEpoch);

    if (previousClaims === undefined) {
      throw new Error("Previous claims are undefined");
    }
    const cumulativeClaims = PriceEpochRewards.mergeClaims(previousClaims, claims, priceEpochId);
    // last (claiming) cumulative claim records
    this.rewardEpochCumulativeRewards.set(this.currentRewardEpoch, cumulativeClaims);
    this.currentRewardEpoch++;
    this.firstPriceEpochInNextRewardEpoch += this.epochs.rewardEpochDurationInEpochs;
    // initialize empty cumulative claims for the new reward epoch
    this.rewardEpochCumulativeRewards.set(this.currentRewardEpoch, []);
  }

  /**
   * Calculates the map from voter address to the list of claims for the given price epoch.
   */
  public getRewardMappingForPriceEpoch(priceEpoch: number): Map<string, ClaimReward[]> {
    let result = this.rewardEpochCumulativeRewards.get(this.epochs.rewardEpochIdForPriceEpochId(priceEpoch));
    if (result === undefined) {
      throw new Error(`Reward mapping is not defined for price epoch ${priceEpoch}`);
    }
    let rewardMapping = new Map<string, ClaimReward[]>();
    let currencyAddresses = new Map<string, Set<string>>();
    for (let claim of result) {
      let address = claim.claimRewardBody.voterAddress;
      let currencyAddress = claim.claimRewardBody.currencyAddress;
      let addressClaims = rewardMapping.get(address) || [];
      let addressCurrencyAddresses = currencyAddresses.get(address) || new Set<string>();
      rewardMapping.set(address, addressClaims);
      currencyAddresses.set(address, addressCurrencyAddresses);
      addressClaims.push(claim);
      addressCurrencyAddresses.add(currencyAddress);
      if (addressClaims.length !== addressCurrencyAddresses.size) {
        console.dir(result);
        throw new Error(`Duplicate claim for ${address} and ${currencyAddress}`);
      }
    }
    return rewardMapping;
  }
}
