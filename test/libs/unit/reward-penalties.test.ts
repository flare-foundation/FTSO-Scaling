import { expect } from "chai";
import { PENALTY_FACTOR } from "../../../libs/ftso-core/src/configs/networks";
import { RewardTypePrefix } from "../../../libs/ftso-core/src/reward-calculation/RewardTypePrefix";
import { calculatePenalties } from "../../../libs/ftso-core/src/reward-calculation/reward-penalties";
import { PartialRewardOffer } from "../../../libs/ftso-core/src/utils/PartialRewardOffer";
import { Address } from "../../../libs/ftso-core/src/voting-types";
import { generateAddress, generateRewardsOffer, generateVotersWeights } from "../../utils/generators";
import { getTestFile } from "../../utils/getTestFile";
import { splitToVotingRoundsEqually } from "./generator-rewards.test";

describe(`Reward penalties, ${getTestFile(__filename)}`, function () {
  const votersWeights = generateVotersWeights(10);

  const revealOffenders = new Set<Address>();

  revealOffenders.add(generateAddress(`0`));
  revealOffenders.add(generateAddress(`2`));

  const offerFull = generateRewardsOffer("USD EUR", 13, generateAddress("claim"), 10000000);

  const offerPartial = PartialRewardOffer.fromRewardOffered(offerFull);

  const perRoundOffer = splitToVotingRoundsEqually(10, 109, offerPartial);

  const penaltyClaims = calculatePenalties(
    perRoundOffer[0],
    PENALTY_FACTOR(),
    revealOffenders,
    votersWeights,
    RewardTypePrefix.REVEAL_OFFENDERS
  );

  it("should calculate penalties", function () {
    expect(penaltyClaims.length).to.eq(7);
  });
});
