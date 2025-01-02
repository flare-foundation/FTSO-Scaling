import { expect } from "chai";
import { getTestFile } from "../../utils/getTestFile";
import Web3 from "web3";
import { InflationRewardsOffered, RewardsOffered } from "../../../libs/contracts/src/events";
import { PartialRewardOffer } from "../../../libs/fsp-rewards/src/utils/PartialRewardOffer";
import { toFeedId } from "../../utils/generators";
import { splitToVotingRoundsEqually } from "./generator-rewards.test";

describe(`PartialRewardOffer, ${getTestFile(__filename)}`, function () {
  //To be reviewed
  const rawRewardOffer = {
    rewardEpochId: "0x11",
    feedId: toFeedId("aa"),
    decimals: "0x12",
    amount: "0x10000000000",
    minRewardedTurnoutBIPS: "0x010000",
    primaryBandRewardSharePPM: "0x000100",
    secondaryBandWidthPPM: "0x000011",
    claimBackAddress: Web3.utils.keccak256("address").slice(0, 42),
  };

  const rawInflationRewardOffer = {
    rewardEpochId: "0x11",
    feedIds: "0x" + toFeedId("aa", true) + toFeedId("bb", true),
    decimals: "0x1212",
    amount: "0x10000000001",
    minRewardedTurnoutBIPS: "0x010000",
    primaryBandRewardSharePPM: "0x000100",
    secondaryBandWidthPPMs: "0x000011000011",
    mode: "0x00",
  };

  const rewardsOffered = new RewardsOffered(rawRewardOffer);

  const inflationRewardOffer = new InflationRewardsOffered(rawInflationRewardOffer);

  it("Should construct RewardsOffered", function () {
    expect(rewardsOffered).to.not.be.undefined;
  });

  it("Should construct RewardsOffered from Inflation", function () {
    expect(inflationRewardOffer).to.not.be.undefined;
  });

  it("Should convert to PartialRewardOffer", function () {
    const partialRewardOffer = PartialRewardOffer.fromRewardOffered(rewardsOffered);

    expect(partialRewardOffer.rewardEpochId).to.eq(17);
    expect(partialRewardOffer.decimals).to.eq(18);
    expect(partialRewardOffer.isInflation).to.eq(false);
    expect(partialRewardOffer.claimBackAddress).to.eq(Web3.utils.keccak256("address").slice(0, 42));
    expect(partialRewardOffer.amount).to.eq(16n ** 10n);
  });

  it("Should convert Inflation to PartialRewardOffers", function () {
    const partialRewardOffers = PartialRewardOffer.fromInflationRewardOfferedEquallyDistributed(inflationRewardOffer);

    expect(partialRewardOffers.length).to.eq(2);

    const firstOffer = partialRewardOffers[0];
    const secondOffer = partialRewardOffers[1];

    const value = BigInt("0x10000000000");
    const amount = value / 2n;

    expect(firstOffer.rewardEpochId, "rewardEpochId").to.eq(17);
    expect(secondOffer.decimals, "decimals").to.eq(18);
    expect(firstOffer.isInflation).to.eq(true);
    expect(firstOffer.claimBackAddress, "addr").to.eq("0x000000000000000000000000000000000000dEaD"); // Do we prefer mixed case or lowercase
    expect(secondOffer.claimBackAddress).to.eq("0x000000000000000000000000000000000000dEaD");

    expect(firstOffer.amount).to.eq(amount + 1n);
    expect(secondOffer.amount).to.eq(amount);
  });

  it("Should split", function () {
    const partialRewardOffer = PartialRewardOffer.fromRewardOffered(rewardsOffered);
    const splitPartialRewardOffer = splitToVotingRoundsEqually(10, 100, partialRewardOffer);

    expect(splitPartialRewardOffer.length).to.eq(91);
    expect(splitPartialRewardOffer[0].amount, "0").to.eq(12082545361n);
    expect(splitPartialRewardOffer[15].amount, "15").to.eq(12082545361n);
    expect(splitPartialRewardOffer[16].amount, "16").to.eq(12082545360n);
    expect(splitPartialRewardOffer[90].amount, "90").to.eq(12082545360n);
  });
});
