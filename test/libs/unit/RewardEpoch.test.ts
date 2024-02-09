import { expect, assert } from "chai";
import { getTestFile } from "../../utils/getTestFile";
import { generateAddress, generateRewardEpoch } from "../../utils/generators";

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

  it("should get ftsoMedianVotingWeight", function () {
    const okAddress = generateAddress("1submit");

    const votingWeight = rewardEpoch.ftsoMedianVotingWeight(okAddress);

    expect(votingWeight).to.eq(1000n);
  });

  it("should fail ftsoMedianVotingWeight", function () {
    const failAddress = generateAddress("1delegation");

    expect(() => rewardEpoch.ftsoMedianVotingWeight(failAddress)).to.throw("Invalid submission address");
  });

  it("should get signing weight", function () {
    const okAddress = generateAddress("1signing");

    const signingWeight = rewardEpoch.signerToSigningWeight(okAddress);
    expect(signingWeight).to.eq(1000);
  });

  it("should not get signing weight", function () {
    const failAddress = generateAddress("1delegation");

    const signingWeight = rewardEpoch.signerToSigningWeight(failAddress);
    expect(signingWeight).to.be.undefined;
  });

  it("should get voting policy index", function () {
    const okAddress = generateAddress("1signing");

    const index = rewardEpoch.signerToVotingPolicyIndex(okAddress);
    expect(index).to.eq(1);
  });

  it("should not get voting policy index", function () {
    const failAddress = generateAddress("1submit");

    const index = rewardEpoch.signerToVotingPolicyIndex(failAddress);
    expect(index).to.be.undefined;
  });

  it("should get full voter info", function () {
    const okAddress = generateAddress("1signing");

    const info = rewardEpoch.fullVoterRegistrationInfoForSigner(okAddress);
    assert(info);
  });

  it("should not get full voter info", function () {
    const okAddress = generateAddress("1");

    const info = rewardEpoch.fullVoterRegistrationInfoForSigner(okAddress);
    assert(!info);
  });

  it("should get voter weights", function () {
    const weights = rewardEpoch.getVoterWeights();
    expect(weights.size).to.eq(10);
  });

  it("should get feed order", function () {
    const order = rewardEpoch.canonicalFeedOrder;

    expect(order.length).to.eq(11);
  });
});
