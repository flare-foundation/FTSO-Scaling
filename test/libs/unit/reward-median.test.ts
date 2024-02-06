import Web3 from "web3";
import { calculateMedianRewardClaims } from "../../../libs/ftso-core/src/reward-calculation/reward-median";
import { PartialRewardOffer } from "../../../libs/ftso-core/src/utils/PartialRewardOffer";
import {
  generateInflationRewardOffer,
  generateMedianCalculationResult,
  generateVotersWeights,
} from "../../utils/generators";
import { getTestFile } from "../../utils/getTestFile";
import { expect } from "chai";

describe(`Reward median, ${getTestFile(__filename)}`, function () {
  const medianCalculationResult = generateMedianCalculationResult(7, "USD EUR", 10);

  const voterWeights = generateVotersWeights(7);

  const inflationReward = generateInflationRewardOffer(["USD EUR"], 508);

  const partialRewardOfferInflation = PartialRewardOffer.fromInflationRewardOfferedEquallyDistributed(inflationReward);

  const splitPartialRewardOfferInflation = PartialRewardOffer.splitToVotingRoundsEqually(
    10,
    100,
    partialRewardOfferInflation[0]
  );

  it("should calculate rewards", function () {
    console.log(splitPartialRewardOfferInflation[0]);

    const claims = calculateMedianRewardClaims(
      splitPartialRewardOfferInflation[0],
      medianCalculationResult,
      voterWeights
    );

    expect(claims.length).to.be.eq(10);
  });
});
