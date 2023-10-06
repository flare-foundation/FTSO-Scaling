import { EpochSettings } from "../../src/EpochSettings";
import { RewardCalculator } from "../../src/RewardCalculator";
import { calculateResultsForFeed } from "../../src/median-calculation-utils";
import { Feed, Offer, RewardOffered } from "../../src/voting-interfaces";
import { feedToText, toBN } from "../../src/voting-utils";
import { getTestFile } from "../../test-utils/utils/constants";
import { generateOfferForSymbol, prepareSymbols } from "../EndToEnd.utils";

function getAccountAddress(): string {
  return web3.eth.accounts.create().address.toLowerCase();
}

const FEED_COUNT = 4;
const VOTER_COUNT = 3;
const EPOCH_DURATION_SEC = 10;
const PRICE_EPOCHS_FOR_REWARD_EPOCH = 4;
const FIRST_REWARD_EPOCH = 0;

describe(`RewardCalculator; ${getTestFile(__filename)}`, () => {
  const claimerAddress = web3.eth.accounts.create().address.toLowerCase();
  const epochSettings = new EpochSettings(0, EPOCH_DURATION_SEC, FIRST_REWARD_EPOCH, PRICE_EPOCHS_FOR_REWARD_EPOCH);
  const feeds = prepareSymbols(FEED_COUNT);

  function generateReceivedOffer(offerAmount: number, symbol: Feed): RewardOffered {
    const amountBN = toBN(offerAmount);
    const offer = generateOfferForSymbol(claimerAddress, amountBN, symbol, []);
    const decoded = feedToText(offer) as Offer;
    return {
      ...decoded,
      flrValue: amountBN,
    };
  }

  let calculator: RewardCalculator;

  beforeEach(() => {
    calculator = new RewardCalculator(epochSettings, FIRST_REWARD_EPOCH);
  });

  it("should distribute reward value to epochs correctly: div remainder should be distributed to epochs sequentially", () => {
    const baseEpochAmount = 10;
    const remainder = PRICE_EPOCHS_FOR_REWARD_EPOCH - 1; // All epochs apart from last one should get additional 1
    const totalAmount = PRICE_EPOCHS_FOR_REWARD_EPOCH * baseEpochAmount + remainder;

    const offer = generateReceivedOffer(totalAmount, feeds[0]);

    const epochAmounts: number[] = [];
    for (let epoch = 0; epoch < PRICE_EPOCHS_FOR_REWARD_EPOCH; epoch++) {
      const priceEpochOffer = calculator.rewardOfferForPriceEpoch(epoch, offer);
      epochAmounts.push(priceEpochOffer.amount.toNumber());
    }

    epochAmounts.forEach((amount, index) => {
      if (index != epochAmounts.length - 1) {
        expect(amount).to.eq(baseEpochAmount + 1);
      } else {
        expect(amount).to.eq(baseEpochAmount);
      }
    });
  });

  it("should calculate correct amount of claims for price epoch", () => {
    const feed = feeds[0];
    const priceEpochId = 0;

    const offerAmount = 1000;
    const offer = generateReceivedOffer(offerAmount, feed);
    calculator.setRewardOffers(0, [offer]);
    const expectedPriceEpochOfferShare = calculator.rewardOfferForPriceEpoch(0, offer);

    const voterWeights = new Map<string, BN>();
    const feedPrices: BN[] = [];
    // Set equal weights and prices for all offers
    for (let i = 1; i <= VOTER_COUNT; i++) {
      voterWeights.set(getAccountAddress(), toBN(100));
      feedPrices.push(toBN(1000));
    }

    const voters = [...voterWeights.keys()];
    const weights = [...voterWeights.values()];
    const calculationResults = calculateResultsForFeed(voters, feedPrices, weights, feed);

    expect(() => {
      calculator.getRewardMappingForPriceEpoch(priceEpochId);
    }).to.throw();

    calculator.calculateClaimsForPriceEpoch(
      priceEpochId,
      voters[0],
      voters.slice(0, 2),
      [calculationResults],
      [],
      voterWeights
    );

    const claimsByVoter = calculator.getRewardMappingForPriceEpoch(priceEpochId);
    expect(claimsByVoter.size).to.eq(VOTER_COUNT);

    let totalClaimAmount = toBN(0);
    for (const claims of claimsByVoter.values()) {
      for (const claim of claims) {
        totalClaimAmount = totalClaimAmount.add(claim.amount);
      }
    }
    expect(totalClaimAmount).to.bignumber.eq(expectedPriceEpochOfferShare.amount);
  });
});
