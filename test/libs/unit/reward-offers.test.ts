import { assert, expect } from "chai";
import { InflationRewardsOffered } from "../../../libs/contracts/src/events/InflationRewardsOffered";
import { RewardsOffered } from "../../../libs/contracts/src/events/RewardsOffered";
import {
  distributeInflationRewardOfferToFeeds,
  splitRewardOfferByTypes,
} from "../../../libs/fsp-rewards/src/reward-calculation/reward-offers";
import { generateAddress, generateInflationRewardOffer, generateRewardsOffer, toFeedId } from "../../utils/generators";
import { getTestFile } from "../../utils/getTestFile";
import { PartialRewardOffer } from "../../../libs/fsp-rewards/src/utils/PartialRewardOffer";
import { granulatedPartialOfferMap } from "./generator-rewards.test";


import { RewardOffers } from "../../../libs/ftso-core/src/data/RewardOffers";

describe(`Reward offers, ${getTestFile(__filename)}`, function () {
  const rewardEpochId = 1000;

  const rewardsOffered: RewardsOffered[] = [];

  for (let j = 0; j < 10; j++) {
    const rewardOffered = generateRewardsOffer(`USD C${j}`, rewardEpochId, generateAddress(`${j}`), j * 100000);
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
    const feedId3 = toFeedId("USD C3");
    const feedId4 = toFeedId("USD C4");
    const feedId10 = toFeedId("USD C10");

    expect(granulatedPartialOffers.get(5893).get(feedId3).length).to.eq(3);
    expect(granulatedPartialOffers.get(5893).get(feedId4).length).to.eq(2);
    expect(granulatedPartialOffers.get(5893).get(feedId10).length).to.eq(1);
  });

  it("should split reward by types", function () {
    const rewardOffered = generateRewardsOffer(`USD C7`, rewardEpochId, generateAddress(`7`), 10000000);

    const partialRewardOffer = PartialRewardOffer.fromRewardOffered(rewardOffered);

    const splitRewardOffers = splitRewardOfferByTypes(PartialRewardOffer.remapToPartialOfferForRound(partialRewardOffer, 1));

    const finalization = splitRewardOffers.finalizationRewardOffer;
    const signing = splitRewardOffers.signingRewardOffer;
    const median = splitRewardOffers.medianRewardOffer;

    const total = finalization.amount + signing.amount + median.amount;
    expect(total).to.eq(BigInt(10000000));
  });

  it("should split reward by types inflation", function () {
    const rewardOffered = generateInflationRewardOffer([`USD C7`, `USD C3`], rewardEpochId);

    const partialRewardOffers = distributeInflationRewardOfferToFeeds(rewardOffered);

    const splitRewardOffers = splitRewardOfferByTypes(PartialRewardOffer.remapToPartialOfferForRound(partialRewardOffers[0], 1));

    const finalization = splitRewardOffers.finalizationRewardOffer;
    const signing = splitRewardOffers.signingRewardOffer;
    const median = splitRewardOffers.medianRewardOffer;

    const total = finalization.amount + signing.amount + median.amount;
    expect(total).to.eq(1n + BigInt("0x10000000000") / 2n);
  });
});
