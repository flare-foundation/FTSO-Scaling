import BN from "bn.js";
import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import { VoterRegistryInstance, VotingManagerInstance } from "../../typechain-truffle";
import { getTestFile } from "../../test-utils/utils/constants";
import { toBN } from "../../src/protocol/utils/voting-utils";
import { moveToNextRewardEpochStart } from "../../test-utils/utils/voting-test-utils";

chai.use(chaiBN(BN));

const VoterRegistry = artifacts.require("VoterRegistry");
const VotingManager = artifacts.require("VotingManager");

const REWARD_EPOCH_DURATION = 10;
const THRESHOLD = 5000;
const NUM_VOTERS = 10;
const VOTER_WEIGHT = toBN(1000);
const TEST_REWARD_EPOCH = 1;

contract(`VoterRegistry.sol; ${getTestFile(__filename)}`, async accounts => {
  let voterRegistry: VoterRegistryInstance;
  let votingManager: VotingManagerInstance;
  let firstRewardedPriceEpoch: BN;

  before(async () => {
    const governance = accounts[0];
    votingManager = await VotingManager.new(governance);
    firstRewardedPriceEpoch = await votingManager.getCurrentPriceEpochId();
    await votingManager.configureRewardEpoch(firstRewardedPriceEpoch, REWARD_EPOCH_DURATION);
    voterRegistry = await VoterRegistry.new(governance, votingManager.address, THRESHOLD);
  });

  it("Should have correct vote powers and threshold", async () => {
    for (let i = 1; i <= NUM_VOTERS; i++) {
      await voterRegistry.registerAsAVoter(TEST_REWARD_EPOCH, VOTER_WEIGHT, { from: accounts[i] });
    }
    await moveToNextRewardEpochStart(votingManager, firstRewardedPriceEpoch, REWARD_EPOCH_DURATION);

    const totalWeight = VOTER_WEIGHT.mul(toBN(NUM_VOTERS));
    expect(await voterRegistry.totalWeightPerRewardEpoch(TEST_REWARD_EPOCH)).to.be.bignumber.eq(totalWeight);
    for (let i = 1; i <= NUM_VOTERS; i++) {
      expect(await voterRegistry.getVoterWeightForRewardEpoch(accounts[i], TEST_REWARD_EPOCH)).to.be.bignumber.eq(
        VOTER_WEIGHT
      );
    }
    expect(await voterRegistry.thresholdForRewardEpoch(TEST_REWARD_EPOCH)).to.be.bignumber.eq(
      totalWeight.mul(toBN(THRESHOLD)).div(toBN(10000))
    );
  });
});
