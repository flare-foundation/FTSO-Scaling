import { expect } from "chai";
import { RewardTypePrefix } from "../../../libs/fsp-rewards/src/reward-calculation/RewardTypePrefix";
import { calculatePenalties } from "../../../libs/fsp-rewards/src/reward-calculation/reward-penalties";
import { PartialRewardOffer } from "../../../libs/fsp-rewards/src/utils/PartialRewardOffer";
import { Address } from "../../../libs/ftso-core/src/voting-types";
import { generateAddress, generateRewardsOffer, generateVotersWeights } from "../../utils/generators";
import { getTestFile } from "../../utils/getTestFile";
import { splitToVotingRoundsEqually } from "./generator-rewards.test";
import { PENALTY_FACTOR } from "../../../libs/fsp-rewards/src/constants";

describe(`Reward penalties (${getTestFile(__filename)})`, () => {
  const votersWeights = generateVotersWeights(10);

  const revealOffenders = new Set<Address>();

  revealOffenders.add(generateAddress(`0`));
  revealOffenders.add(generateAddress(`2`));

  const offerFull = generateRewardsOffer("USD EUR", 13, generateAddress("claim"), 10000000);

  const offerPartial = PartialRewardOffer.fromRewardOffered(offerFull);

  const perRoundOffer = splitToVotingRoundsEqually(10, 109, offerPartial);

  // Pre-FIP.16 reward epoch id, so the legacy delegation-only weighting is exercised.
  const rewardEpochId = 0;

  const penaltyClaims = calculatePenalties(
    perRoundOffer[0],
    PENALTY_FACTOR(),
    revealOffenders,
    votersWeights,
    RewardTypePrefix.REVEAL_OFFENDERS,
    rewardEpochId
  );

  it("emits the expected number of penalty claims for the reveal-offender set", () => {
    expect(penaltyClaims.length).to.eq(7);
  });
});
