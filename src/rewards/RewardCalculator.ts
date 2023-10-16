import BN from "bn.js";
import { EpochSettings } from "../EpochSettings";
import { PriceEpochRewards } from "./PriceEpochRewards";
import { FeedValue, MedianCalculationResult, RewardOffered, RewardClaim } from "../lib/voting-interfaces";
import { feedId, toBN } from "../lib/voting-utils";
import { getLogger } from "../utils/logger";

/** 10% of total reward goes to the finalizer. */
const FINALIZATION_BIPS = toBN(1_000);
/** 10% of total reward goes to finalization signatures. */
const SIGNING_BIPS = toBN(1_000);
const TOTAL_BIPS = toBN(10_000);

const MISSED_REVEAL_PENALIZATION: BN = toBN(10);

export class Penalty implements RewardClaim {
  readonly isFixedClaim = true;
  constructor(
    readonly amount: BN,
    readonly currencyAddress: string,
    readonly beneficiary: string,
    readonly priceEpochId: number
  ) {}
}

/**
 * Reward calculator for sequence of reward epochs.
 * In essence it is initialized with the start reward epoch and the corresponding initial price epoch.
 * Then it gets filled in with the reward offers for each reward epoch and the calculation results in order of
 * price epochs. In the process all the claims are calculated and stored for each price epoch and reward epoch.
 */
export class RewardCalculator {
  ////////////// Initial processing boundaries //////////////
  /** First price epoch of initialRewardEpoch for which we're calculating rewards. */
  private initialPriceEpoch: number;

  ////////////// Progress counters //////////////
  /** First price epoch of the next reward epoch in calculation. Used to determine when to move to the next reward epoch. */
  private firstPriceEpochInNextRewardEpoch: number;
  /** Next price epoch to be processed. */
  private currentUnprocessedPriceEpoch: number;
  /** Current reward epoch that is being processed. */
  private currentRewardEpoch: number;

  ////////////// Offer data //////////////
  /** rewardEpochId => list of reward offers */
  readonly rewardOffers = new Map<number, RewardOffered[]>();
  /** rewardEpochId => feedId => list of reward offers. The offers in the same currency are accumulated. */
  readonly rewardOffersBySymbol = new Map<number, Map<string, RewardOffered[]>>();

  ////////////// Claim data //////////////
  /** rewardEpochId => list of cumulative claims and penalties. */
  private readonly rewardEpochCumulativeRewards = new Map<number, RewardClaim[]>();
  /** rewardEpochId => canonical list of feeds in the reward epoch. */
  private readonly feedSequenceForRewardEpoch = new Map<number, FeedValue[]>();

  constructor(private readonly epochs: EpochSettings, initialRewardEpoch: number) {
    getLogger("RewardCalculator").info(`Initializing reward calculator for reward epoch ${initialRewardEpoch}`);

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
  public calculateClaimsForPriceEpoch(
    priceEpochId: number,
    /** Can only be undefined during for the very first price epoch in FTSO. */
    finalizerAddress: string | undefined,
    signers: string[],
    calculationResults: MedianCalculationResult[],
    committedFailedReveal: string[],
    voterWeights: Map<string, BN>
  ) {
    if (priceEpochId !== this.currentUnprocessedPriceEpoch) {
      throw new Error(
        `Price epoch ${priceEpochId} is not the current unprocessed price epoch ${this.currentUnprocessedPriceEpoch}`
      );
    }

    const rewardEpochId = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);
    const rewardEpochOffers = this.rewardOffers.get(rewardEpochId);
    const priceEpochOffers = rewardEpochOffers?.map(offer => this.rewardOfferForPriceEpoch(priceEpochId, offer))!;

    const signingOffers: RewardOffered[] = [];
    const finalizationOffers: RewardOffered[] = [];
    const medianOffers: RewardOffered[] = [];

    const currentPriceEpochClaims: RewardClaim[] = [];

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

      const finalizationClaims = PriceEpochRewards.claimsForFinalizer(
        finalizationOffers,
        finalizerAddress,
        priceEpochId
      );
      currentPriceEpochClaims.push(...finalizationClaims);

      const signerClaims = PriceEpochRewards.claimsForSigners(signingOffers, signers, priceEpochId);
      currentPriceEpochClaims.push(...signerClaims);
    }
    const resultClaims = PriceEpochRewards.claimsForSymbols(priceEpochId, calculationResults, medianOffers);
    currentPriceEpochClaims.push(...resultClaims);

    PriceEpochRewards.assertOffersVsClaimsStats(priceEpochOffers, currentPriceEpochClaims);

    if (committedFailedReveal.length > 0) {
      console.log(
        `Penalizing ${committedFailedReveal.length} voters for missed reveal: ${Array.from(
          committedFailedReveal.entries()
        )} `
      );
      const penalties = this.computePenalties(priceEpochId, committedFailedReveal, priceEpochOffers, voterWeights);
      currentPriceEpochClaims.push(...penalties);
    }

    this.addToCumulativeClaims(priceEpochId, currentPriceEpochClaims);
    this.currentUnprocessedPriceEpoch++;
  }

  private computePenalties(
    priceEpochId: number,
    committedFailedReveal: string[],
    priceEpochOffers: RewardOffered[],
    voterWeights: Map<string, BN>
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
        getLogger("RewardClaims").info(`Created penalty for missed reveal: ${JSON.stringify(penalty)}`);
        penaltyClaims.push(penalty);
      }
    }

    return penaltyClaims;
  }

  private addToCumulativeClaims(priceEpochId: number, currentClaims: RewardClaim[]) {
    getLogger("RewardMerge").info(`Adding claims for price epoch ${priceEpochId}: ${JSON.stringify(currentClaims)}`);
    if (priceEpochId < this.firstPriceEpochInNextRewardEpoch - 1) {
      if (priceEpochId === this.initialPriceEpoch) {
        this.rewardEpochCumulativeRewards.set(
          this.currentRewardEpoch,
          PriceEpochRewards.mergeClaims(priceEpochId, currentClaims)
        );
      } else {
        this.mergeWithPreviousClaims(priceEpochId, currentClaims);
      }
    } else {
      this.mergeWithPreviousClaims(priceEpochId, currentClaims);
      // we are in the last price epoch of the current reward epoch
      // the reward epoch is not yet shifted to the next reward epoch, matching the price epoch
      this.shiftRewardEpoch();
    }
  }

  private mergeWithPreviousClaims(priceEpochId: number, claims: RewardClaim[]) {
    const previousClaims = this.rewardEpochCumulativeRewards.get(this.currentRewardEpoch);
    if (previousClaims === undefined) {
      throw new Error("Previous claims are undefined");
    }
    const cumulativeClaims = PriceEpochRewards.mergeClaims(priceEpochId, previousClaims.concat(claims));
    this.rewardEpochCumulativeRewards.set(this.currentRewardEpoch, cumulativeClaims);
  }

  private shiftRewardEpoch() {
    this.currentRewardEpoch++;
    this.firstPriceEpochInNextRewardEpoch += this.epochs.rewardEpochDurationInEpochs;
    // initialize empty cumulative claims for the new reward epoch
    this.rewardEpochCumulativeRewards.set(this.currentRewardEpoch, []);
  }

  public getRewardClaimsForPriceEpoch(priceEpoch: number): RewardClaim[] {
    return this.rewardEpochCumulativeRewards.get(this.epochs.rewardEpochIdForPriceEpochId(priceEpoch))!;
  }
  public getRewardClaimsForRewardEpoch(rewardEpoch: number): RewardClaim[] {
    return this.rewardEpochCumulativeRewards.get(rewardEpoch)!;
  }


  /**
   * Calculates the map from voter address to the list of claims for the given price epoch.
   */
  public getRewardMappingForPriceEpoch(priceEpoch: number): Map<string, RewardClaim[]> {
    const claimsForRewardEpoch = this.rewardEpochCumulativeRewards.get(
      this.epochs.rewardEpochIdForPriceEpochId(priceEpoch)
    );
    if (claimsForRewardEpoch === undefined) {
      throw new Error(`Reward mapping is not defined for price epoch ${priceEpoch}`);
    }
    const claimsByVoter = new Map<string, RewardClaim[]>();
    const currencyAddresses = new Map<string, Set<string>>();
    for (const claim of claimsForRewardEpoch) {
      const address = claim.beneficiary;
      const currencyAddress = claim.currencyAddress;
      const voterClaims = claimsByVoter.get(address) || [];
      const addressCurrencyAddresses = currencyAddresses.get(address) || new Set<string>();
      claimsByVoter.set(address, voterClaims);
      currencyAddresses.set(address, addressCurrencyAddresses);
      voterClaims.push(claim);
      addressCurrencyAddresses.add(currencyAddress);
    }
    return claimsByVoter;
  }
}
