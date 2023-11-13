import BN from "bn.js";
import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import { VoterRegistryInstance, VotingInstance, VotingManagerInstance } from "../../typechain-truffle";
import { getTestFile } from "../../test-utils/utils/constants";
import { toBN } from "../../src/protocol/utils/voting-utils";

chai.use(chaiBN(BN));

const Voting = artifacts.require("Voting");
const VoterRegistry = artifacts.require("VoterRegistry");
const VotingManager = artifacts.require("VotingManager");

const REWARD_EPOCH_DURATION = 10;
const THRESHOLD = 5000;

contract(`Voting contracts setup general tests; ${getTestFile(__filename)}`, async accounts => {
  let voting: VotingInstance;
  let voterRegistry: VoterRegistryInstance;
  let votingManager: VotingManagerInstance;
  const governance = accounts[0];
  let firstRewardedPriceEpoch: BN;
  let firstEpochStartSec: BN;
  let epochDurationSec: BN;

  before(async () => {
    votingManager = await VotingManager.new(governance);
    voterRegistry = await VoterRegistry.new(governance, votingManager.address, THRESHOLD);
    voting = await Voting.new(voterRegistry.address, votingManager.address);
    firstRewardedPriceEpoch = await votingManager.getCurrentPriceEpochId();
    await votingManager.configureRewardEpoch(firstRewardedPriceEpoch, REWARD_EPOCH_DURATION);

    firstEpochStartSec = await votingManager.BUFFER_TIMESTAMP_OFFSET();
    epochDurationSec = await votingManager.BUFFER_WINDOW();
  });

  it("Should be deployed", async () => {
    expect(voting.address).to.not.be.null;
    expect(voterRegistry.address).to.not.be.null;
    expect(votingManager.address).to.not.be.null;
  });

  it("Should have correct epoch configuration", async () => {
    expect(await votingManager.firstRewardedPriceEpoch()).to.be.bignumber.eq(firstRewardedPriceEpoch);
    expect(await votingManager.rewardEpochDurationInEpochs()).to.be.bignumber.eq(toBN(REWARD_EPOCH_DURATION));
  });

  it("Should start at reward epoch 0", async () => {
    expect(await votingManager.getCurrentRewardEpochId()).to.be.bignumber.eq(toBN(0));
  });

  it("Should return correct reward epoch for given epoch", async () => {
    expect(await votingManager.getRewardEpochIdForPriceEpoch(firstRewardedPriceEpoch)).to.be.bignumber.eq(toBN(0));
    expect(
      await votingManager.getRewardEpochIdForPriceEpoch(firstRewardedPriceEpoch.add(toBN(REWARD_EPOCH_DURATION)))
    ).to.be.bignumber.eq(toBN(1));
  });

  it("Should add and remove voter for specific reward epoch", async () => {
    const weight = toBN(1000);
    const rewardEpochId = 1;
    await voterRegistry.registerAsAVoter(rewardEpochId, weight.mul(toBN(2)), { from: accounts[1] });
    await voterRegistry.registerAsAVoter(rewardEpochId, weight, { from: accounts[2] });

    expect(await voterRegistry.getVoterWeightForRewardEpoch(accounts[1], rewardEpochId)).to.be.bignumber.eq(
      weight.mul(toBN(2))
    );
    expect(await voterRegistry.getVoterWeightForRewardEpoch(accounts[2], rewardEpochId)).to.be.bignumber.eq(weight);
    expect(await voterRegistry.totalWeightPerRewardEpoch(rewardEpochId)).to.be.bignumber.eq(weight.mul(toBN(3)));
  });

  it("Should return correct threshold for given reward epoch", async () => {
    const weight = toBN(1000);
    const rewardEpochId = 1;
    expect(await voterRegistry.thresholdForRewardEpoch(rewardEpochId)).to.be.bignumber.eq(
      weight.mul(toBN(3)).mul(toBN(THRESHOLD)).div(toBN(10000))
    );
  });
});
