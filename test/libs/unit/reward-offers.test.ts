import { assert, expect } from "chai";
import { RewardOffers } from "../../../libs/ftso-core/src/events";
import { InflationRewardsOffered } from "../../../libs/ftso-core/src/events/InflationRewardsOffered";
import { RewardsOffered } from "../../../libs/ftso-core/src/events/RewardsOffered";
import {
  distributeInflationRewardOfferToFeeds,
  granulatedPartialOfferMap,
  splitRewardOfferByTypes,
} from "../../../libs/ftso-core/src/reward-calculation/reward-offers";
import { generateAddress, generateInflationRewardOffer, generateRewardsOffer } from "../../utils/generators";
import { getTestFile } from "../../utils/getTestFile";
import Web3 from "web3";
import { PartialRewardOffer } from "../../../libs/ftso-core/src/utils/PartialRewardOffer";

describe(`Reward offers, ${getTestFile(__filename)}`, function () {
  const rewardEpochId = 1000;

  const rewardsOffered: RewardsOffered[] = [];

  for (let j = 0; j < 10; j++) {
    const rewardOffered = generateRewardsOffer(`USD C${j}`, rewardEpochId, generateAddress(`${j}`));
    rewardsOffered.push(rewardOffered);
  }

  const inflationOffers: InflationRewardsOffered[] = [];

  let feedNames: string[] = [];
  for (let j = 0; j < 4; j++) {
    feedNames.push(`USD C${j}`);
  }

  inflationOffers.push(generateInflationRewardOffer(feedNames, rewardEpochId));

  feedNames = [];

  for (let j = 3; j < 11; j++) {
    feedNames.push(`USD C${j}`);
  }

  inflationOffers.push(generateInflationRewardOffer(feedNames, rewardEpochId));

  const rewardOffers: RewardOffers = {
    inflationOffers,
    rewardOffers: rewardsOffered,
  };

  const granulatedPartialOffers = granulatedPartialOfferMap(3600, 7200, rewardOffers);

  it("should be defined", function () {
    assert(granulatedPartialOffers);
  });

  it("should have offers for each feed each round", function () {
    expect(granulatedPartialOffers.get(3600).size).to.eq(11);
    expect(granulatedPartialOffers.get(5893).size).to.eq(11);
    expect(granulatedPartialOffers.get(7200).size).to.eq(11);

    expect(granulatedPartialOffers.get(123124)).to.be.undefined;
  });

  it("should have offers for each feed each round", function () {
    const feedName3 = Web3.utils.padRight(Web3.utils.utf8ToHex("USD C3"), 16).slice(0, 18);
    const feedName4 = Web3.utils.padRight(Web3.utils.utf8ToHex("USD C4"), 16).slice(0, 18);
    const feedName10 = Web3.utils.padRight(Web3.utils.utf8ToHex("USD C10"), 16).slice(0, 18);

    expect(granulatedPartialOffers.get(5893).get(feedName3).length).to.eq(3);
    expect(granulatedPartialOffers.get(5893).get(feedName4).length).to.eq(2);
    expect(granulatedPartialOffers.get(5893).get(feedName10).length).to.eq(1);
  });

  it("should split reward by types", function () {
    const rewardOffered = generateRewardsOffer(`USD C7`, rewardEpochId, generateAddress(`7`));

    const partialRewardOffer = PartialRewardOffer.fromRewardOffered(rewardOffered);

    const splitRewardOffers = splitRewardOfferByTypes(partialRewardOffer);

    const finalization = splitRewardOffers.finalizationRewardOffer;
    const signing = splitRewardOffers.signingRewardOffer;
    const median = splitRewardOffers.medianRewardOffer;

    const total = finalization.amount + signing.amount + median.amount;
    expect(total).to.eq(BigInt("0x10000000000"));
  });

  it("should split reward by types inflation", function () {
    const rewardOffered = generateInflationRewardOffer([`USD C7`, `USD C3`], rewardEpochId);

    const partialRewardOffers = distributeInflationRewardOfferToFeeds(rewardOffered);

    const splitRewardOffers = splitRewardOfferByTypes(partialRewardOffers[0]);

    const finalization = splitRewardOffers.finalizationRewardOffer;
    const signing = splitRewardOffers.signingRewardOffer;
    const median = splitRewardOffers.medianRewardOffer;

    const total = finalization.amount + signing.amount + median.amount;
    expect(total).to.eq(1n + BigInt("0x10000000000") / 2n);
  });
});
