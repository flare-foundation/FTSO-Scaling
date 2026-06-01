import { expect } from "chai";
import { calculateMedianRewardClaims } from "../../../libs/fsp-rewards/src/reward-calculation/reward-median";
import { PartialRewardOffer } from "../../../libs/fsp-rewards/src/utils/PartialRewardOffer";
import {
  generateAddress,
  generateInflationRewardOffer,
  generateMedianCalculationResult,
  generateRewardsOffer,
  generateVotersWeights,
} from "../../utils/generators";
import { getTestFile } from "../../utils/getTestFile";
import { splitToVotingRoundsEqually } from "./generator-rewards.test";

describe(`Reward median (${getTestFile(__filename)})`, () => {
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

  // Pre-FIP.16 reward epoch id, so the legacy delegation-only behaviour is exercised.
  const rewardEpochId = 0;

  it("distributes the full inflation offer across median claims", () => {
    const { rewardClaims } = calculateMedianRewardClaims(
      splitPartialRewardOfferInflation[0],
      medianCalculationResult,
      voterWeights,
      rewardEpochId
    );

    expect(rewardClaims.reduce((a, b) => a + b.amount, 0n)).to.be.eq(splitPartialRewardOfferInflation[0].amount);
  });

  it("burns the inflation offer in a single claim when turnout is too low", () => {
    const { rewardClaims } = calculateMedianRewardClaims(
      splitPartialRewardOfferInflation[0],
      medianCalculationResultLowTurnout,
      voterWeights,
      rewardEpochId
    );

    expect(rewardClaims.length).to.eq(1);
    expect(rewardClaims.reduce((a, b) => a + b.amount, 0n)).to.be.eq(splitPartialRewardOfferInflation[0].amount);
  });

  it("distributes the full community offer across median claims", () => {
    const { rewardClaims } = calculateMedianRewardClaims(
      splitPartialOfferedReward[0],
      medianCalculationResult,
      voterWeights,
      rewardEpochId
    );

    expect(rewardClaims.reduce((a, b) => a + b.amount, 0n)).to.be.eq(splitPartialOfferedReward[0].amount);
  });

  it("distributes a community offer with zero secondary band width", () => {
    const { rewardClaims } = calculateMedianRewardClaims(
      splitPartialOfferedRewardNoSecondary[0],
      medianCalculationResult,
      voterWeights,
      rewardEpochId
    );

    expect(rewardClaims.reduce((a, b) => a + b.amount, 0n)).to.be.eq(splitPartialOfferedRewardNoSecondary[0].amount);
  });
});
