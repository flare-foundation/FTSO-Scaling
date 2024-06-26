import { expect } from "chai";
import { calculateMedianRewardClaims } from "../../../libs/ftso-core/src/reward-calculation/reward-median";
import { PartialRewardOffer } from "../../../libs/ftso-core/src/utils/PartialRewardOffer";
import {
  generateAddress,
  generateInflationRewardOffer,
  generateMedianCalculationResult,
  generateRewardsOffer,
  generateVotersWeights,
} from "../../utils/generators";
import { getTestFile } from "../../utils/getTestFile";
import { splitToVotingRoundsEqually } from "./generator-rewards.test";

describe(`Reward median, ${getTestFile(__filename)}`, function () {
  const medianCalculationResult = generateMedianCalculationResult(70, "USD EUR", 10);
  const medianCalculationResultLowTurnout = generateMedianCalculationResult(70, "USD EUR", 10, true);

  const voterWeights = generateVotersWeights(70);

  const inflationReward = generateInflationRewardOffer(["USD EUR"], 508);

  const partialRewardOfferInflation = PartialRewardOffer.fromInflationRewardOfferedEquallyDistributed(inflationReward);

  const splitPartialRewardOfferInflation = splitToVotingRoundsEqually(10, 100, partialRewardOfferInflation[0]);

  const offeredReward = generateRewardsOffer("USD EUR", 508, generateAddress("claimBack"), 10000000);

  const partialOfferedReward = PartialRewardOffer.fromRewardOffered(offeredReward);

  const splitPartialOfferedReward = splitToVotingRoundsEqually(10, 100, partialOfferedReward);

  const offeredRewardNoSecondary = generateRewardsOffer("USD EUR", 508, generateAddress("claimBack"), 10000000, 0);

  const partialOfferedRewardNoSecondary = PartialRewardOffer.fromRewardOffered(offeredRewardNoSecondary);

  const splitPartialOfferedRewardNoSecondary = splitToVotingRoundsEqually(10, 100, partialOfferedRewardNoSecondary);

  it("should calculate rewards inflation", function () {
    const claims = calculateMedianRewardClaims(
      splitPartialRewardOfferInflation[0],
      medianCalculationResult,
      voterWeights
    );

    expect(claims.reduce((a, b) => a + b.amount, 0n)).to.be.eq(splitPartialRewardOfferInflation[0].amount);
  });

  it("should calculate rewards inflation low turnout", function () {
    const claims = calculateMedianRewardClaims(
      splitPartialRewardOfferInflation[0],
      medianCalculationResultLowTurnout,
      voterWeights
    );

    expect(claims.length).to.eq(1);
    expect(claims.reduce((a, b) => a + b.amount, 0n)).to.be.eq(splitPartialRewardOfferInflation[0].amount);
  });

  it("should calculate rewards offer", function () {
    const claims = calculateMedianRewardClaims(splitPartialOfferedReward[0], medianCalculationResult, voterWeights);

    expect(claims.reduce((a, b) => a + b.amount, 0n)).to.be.eq(splitPartialOfferedReward[0].amount);
  });

  it("should calculate rewards offer with no secondary width", function () {
    const claims = calculateMedianRewardClaims(
      splitPartialOfferedRewardNoSecondary[0],
      medianCalculationResult,
      voterWeights
    );

    expect(claims.reduce((a, b) => a + b.amount, 0n)).to.be.eq(splitPartialOfferedRewardNoSecondary[0].amount);
  });
});
