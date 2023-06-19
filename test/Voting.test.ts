import { expectEvent } from "@openzeppelin/test-helpers";
import BN from "bn.js";
import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import { VoterRegistryInstance, VotingInstance, VotingManagerInstance } from "../typechain-truffle";
import { getTestFile } from "../test-utils/utils/constants";
import { increaseTimeTo, toBN } from "../test-utils/utils/test-helpers";
chai.use(chaiBN(BN));

const Voting = artifacts.require("Voting");
const VoterRegistry = artifacts.require("VoterRegistry");
const VotingManager = artifacts.require("VotingManager");

contract(`Voting contracts setup general tests; ${getTestFile(__filename)}`, async accounts => {
  let voting: VotingInstance;
  let voterRegistry: VoterRegistryInstance;
  let votingManager: VotingManagerInstance;
  let governance = accounts[0];
  let currentEpoch: BN;
  const REWARD_EPOCH_DURATION = 10;
  const THRESHOLD = 5000;

  let firstEpochStartSec: BN;
  let epochDurationSec: BN;

  before(async () => {
    let now = Math.floor(Date.now() / 1000);
    await increaseTimeTo(now);
    votingManager = await VotingManager.new(governance);
    voterRegistry = await VoterRegistry.new(governance, votingManager.address, THRESHOLD);
    voting = await Voting.new(voterRegistry.address, votingManager.address);
    currentEpoch = await votingManager.getCurrentEpochId();
    await votingManager.configureRewardEpoch(currentEpoch, REWARD_EPOCH_DURATION);

    firstEpochStartSec = await votingManager.BUFFER_TIMESTAMP_OFFSET();
    epochDurationSec = await votingManager.BUFFER_WINDOW();

    let weight = toBN(1000);
    let rewardEpochId = 1;
    let N = 10;

    for(let i = 1; i <= N; i++) {
      await voterRegistry.addVoterWeightForRewardEpoch(accounts[i], rewardEpochId, weight);
    }
    // Go to the next reward epoch (1)
    await increaseTimeTo(
      firstEpochStartSec.add(
        epochDurationSec.mul(
          currentEpoch.add(
            toBN(REWARD_EPOCH_DURATION + 1)
          )
        )
      ).toNumber()
    );
  });

  it("Should vote powers and threshold be set", async () => {
    let rewardEpochId = 1;
    let weight = toBN(1000);
    let N = 10;
    let totalWeight = weight.mul(toBN(N));
    expect(await voterRegistry.totalWeightPerRewardEpoch(rewardEpochId)).to.be.bignumber.eq(totalWeight);
    for(let i = 1; i <= N; i++) {
      expect(await voterRegistry.getVoterWeightForRewardEpoch(accounts[i], rewardEpochId)).to.be.bignumber.eq(weight);
    }
    expect(await voterRegistry.thresholdForRewardEpoch(rewardEpochId)).to.be.bignumber.eq(totalWeight.mul(toBN(THRESHOLD)).div(toBN(10000)));
  });

});
