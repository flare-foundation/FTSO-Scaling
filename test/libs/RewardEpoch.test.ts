import { expect, assert } from "chai";
import { getTestFile } from "../utils/getTestFile";
import { generateAddress, generateRewardEpoch } from "../utils/generators";

describe(`RewardEpoch, ${getTestFile(__filename)}`, function () {
  const rewardEpoch = generateRewardEpoch();

  it("should construct reward epoch", function () {
    expect(rewardEpoch).not.to.be.undefined;
  });

  it("should tell if isEligibleVoterSubmissionAddress", function () {
    const okAddress = generateAddress("1submit");
    const failAddress = generateAddress("anything");

    assert(rewardEpoch.isEligibleVoterSubmissionAddress(okAddress), "ok");
    assert(!rewardEpoch.isEligibleVoterSubmissionAddress(failAddress), "fail");
  });

  it("should tell if isEligibleSignerAddress", function () {
    const okAddress = generateAddress("1signing");
    const failAddress = generateAddress("anything");

    assert(rewardEpoch.isEligibleSignerAddress(okAddress), "ok");
    assert(!rewardEpoch.isEligibleSignerAddress(failAddress), "fail");
  });

  it("should map signerToDelegationAddress", function () {
    const signer = generateAddress("1signing");
    const delegation = generateAddress("1delegation");

    const mapped = rewardEpoch.signerToDelegationAddress(signer);

    expect(delegation).to.eq(mapped);
  });
});
