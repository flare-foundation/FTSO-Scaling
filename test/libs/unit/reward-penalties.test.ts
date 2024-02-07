import { getTestFile } from "../../utils/getTestFile";
import { generateAddress, generateRewardsOffer, generateVotersWeights } from "../../utils/generators";
import { Address } from "../../../libs/ftso-core/src/voting-types";
import { PartialRewardOffer } from "../../../libs/ftso-core/src/utils/PartialRewardOffer";
import { calculateRevealWithdrawalPenalties } from "../../../libs/ftso-core/src/reward-calculation/reward-penalties";
import { expect } from "chai";

describe(`Reward penalties, ${getTestFile(__filename)}`, function () {
  const voterWeights = generateVotersWeights(10);

  const revealOffenders = new Set<Address>();

  for (let j = 2; j < 5; j++) {
    revealOffenders.add(generateAddress(`${j}`));
  }

  const offerFull = generateRewardsOffer("USD EUR", 13, generateAddress("claim"));

  const offerPartial = PartialRewardOffer.fromRewardOffered(offerFull);

  const penaltyClaims = calculateRevealWithdrawalPenalties(offerPartial, revealOffenders, voterWeights);

  it("should calculate penalties", function () {
    expect(penaltyClaims.length).to.eq(3);
  });
});
