import { expect, assert } from "chai";
import { getTestFile } from "../../utils/getTestFile";
import { generateAddress, generateRewardEpoch } from "../../utils/generators";

describe(`RewardEpoch (${getTestFile(__filename)})`, () => {
  const rewardEpoch = generateRewardEpoch();

  it("constructs a non-null RewardEpoch from synthetic events", () => {
    expect(rewardEpoch).not.to.be.undefined;
  });

  it("accepts registered submission addresses and rejects strangers", () => {
    const okAddress = generateAddress("1submit");
    const failAddress = generateAddress("anything");

    assert(rewardEpoch.isEligibleSubmitAddress(okAddress), "ok");
    assert(!rewardEpoch.isEligibleSubmitAddress(failAddress), "fail");
  });

  it("accepts registered signing addresses and rejects strangers", () => {
    const okAddress = generateAddress("1signing");
    const failAddress = generateAddress("anything");

    assert(rewardEpoch.isEligibleSignerAddress(okAddress), "ok");
    assert(!rewardEpoch.isEligibleSignerAddress(failAddress), "fail");
  });

  it("maps a signer to its delegation address", () => {
    const signer = generateAddress("1signing");
    const delegation = generateAddress("1delegation");

    const mapped = rewardEpoch.signerToDelegationAddress(signer);

    expect(delegation).to.eq(mapped);
  });

  it("returns the median voting weight for a registered submission address", () => {
    const okAddress = generateAddress("1submit");

    const votingWeight = rewardEpoch.ftsoMedianVotingWeight(okAddress);

    expect(votingWeight).to.eq(1000n);
  });

  it("throws on ftsoMedianVotingWeight for an unregistered address", () => {
    const failAddress = generateAddress("1delegation");

    expect(() => rewardEpoch.ftsoMedianVotingWeight(failAddress)).to.throw("Invalid submission address");
  });

  it("returns the signing weight for a registered signer", () => {
    const okAddress = generateAddress("1signing");

    const signingWeight = rewardEpoch.signerToSigningWeight(okAddress);
    expect(signingWeight).to.eq(1000);
  });

  it("returns undefined for signerToSigningWeight on an unregistered address", () => {
    const failAddress = generateAddress("1delegation");

    const signingWeight = rewardEpoch.signerToSigningWeight(failAddress);
    expect(signingWeight).to.be.undefined;
  });

  it("returns the voting-policy index for a registered signer", () => {
    const okAddress = generateAddress("1signing");

    const index = rewardEpoch.signerToVotingPolicyIndex(okAddress);
    expect(index).to.eq(1);
  });

  it("returns undefined for signerToVotingPolicyIndex on an unregistered address", () => {
    const failAddress = generateAddress("1submit");

    const index = rewardEpoch.signerToVotingPolicyIndex(failAddress);
    expect(index).to.be.undefined;
  });

  it("returns the full registration info for a registered signer", () => {
    const okAddress = generateAddress("1signing");

    const info = rewardEpoch.fullVoterRegistrationInfoForSigner(okAddress);
    assert(info);
  });

  it("returns undefined for fullVoterRegistrationInfoForSigner on an unregistered address", () => {
    const okAddress = generateAddress("1");

    const info = rewardEpoch.fullVoterRegistrationInfoForSigner(okAddress);
    assert(!info);
  });

  it("exposes voter weights for every registered voter", () => {
    const weights = rewardEpoch.getVotersWeights();
    expect(weights.size).to.eq(50);
  });

  it("exposes the canonical feed order for the reward epoch", () => {
    const order = rewardEpoch.canonicalFeedOrder;

    expect(order.length).to.eq(11);
  });
});
