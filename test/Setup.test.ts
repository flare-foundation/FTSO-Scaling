import { expectEvent } from "@openzeppelin/test-helpers";
import BN from "bn.js";
import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import { VoterRegistryInstance, VotingInstance, VotingManagerInstance } from "../typechain-truffle";
import { getTestFile } from "../test-utils/utils/constants";
import { increaseTimeTo } from "../test-utils/utils/test-helpers";
import { ZERO_BYTES32, toBN } from "../src/voting-utils";
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
  let firstEpochStartSec: BN;
  let epochDurationSec: BN;

  const REWARD_EPOCH_DURATION = 10;
  const THRESHOLD = 5000;

  before(async () => {
    let now = Math.floor(Date.now() / 1000);
    await increaseTimeTo(now);
    votingManager = await VotingManager.new(governance);
    voterRegistry = await VoterRegistry.new(governance, votingManager.address, THRESHOLD);
    voting = await Voting.new(voterRegistry.address, votingManager.address);
    currentEpoch = await votingManager.getCurrentPriceEpochId();
    await votingManager.configureRewardEpoch(currentEpoch, REWARD_EPOCH_DURATION);

    firstEpochStartSec = await votingManager.BUFFER_TIMESTAMP_OFFSET();
    epochDurationSec = await votingManager.BUFFER_WINDOW();
  });

  it("Should be deployed", async () => {
    expect(voting.address).to.not.be.null;
    expect(voterRegistry.address).to.not.be.null;
    expect(votingManager.address).to.not.be.null;
  });

  it("Should reward epoch be configured", async () => {
    expect(await votingManager.firstRewardedPriceEpoch()).to.be.bignumber.eq(currentEpoch);
    expect(await votingManager.rewardEpochDurationInEpochs()).to.be.bignumber.eq(toBN(REWARD_EPOCH_DURATION));
  });

  it("Should current reward epoch be 0", async () => {
    expect(await votingManager.getCurrentRewardEpochId()).to.be.bignumber.eq(toBN(0));
  });

  it("Should return correct reward epoch for given epoch", async () => {
    expect(await votingManager.getRewardEpochIdForEpoch(currentEpoch)).to.be.bignumber.eq(toBN(0));
    expect(await votingManager.getRewardEpochIdForEpoch(currentEpoch.add(toBN(REWARD_EPOCH_DURATION)))).to.be.bignumber.eq(toBN(1));
  });

  it("Should add and remove voter for specific reward epoch", async () => {
    let weight = toBN(1000);
    let rewardEpochId = 1;
    await voterRegistry.registerAsAVoter(rewardEpochId, weight.mul(toBN(2)), {from: accounts[1]});
    await voterRegistry.registerAsAVoter(rewardEpochId, weight, {from: accounts[2]});


    expect(await voterRegistry.getVoterWeightForRewardEpoch(accounts[1], rewardEpochId)).to.be.bignumber.eq(weight.mul(toBN(2)));
    expect(await voterRegistry.getVoterWeightForRewardEpoch(accounts[2], rewardEpochId)).to.be.bignumber.eq(weight);
    expect(await voterRegistry.totalWeightPerRewardEpoch(rewardEpochId)).to.be.bignumber.eq(weight.mul(toBN(3)));
  });


  it("Should return correct threshold for given reward epoch", async () => {
    let weight = toBN(1000);
    let rewardEpochId = 1;
    expect(await voterRegistry.thresholdForRewardEpoch(rewardEpochId)).to.be.bignumber.eq(weight.mul(toBN(3)).mul(toBN(THRESHOLD)).div(toBN(10000)));
  });

  it.skip("Should not be able to add voter weight for running reward epoch", async () => {
    let weight = toBN(1000);
    let rewardEpochId = 0;
    // await expect(voterRegistry.addVoterWeightForRewardEpoch(accounts[1], rewardEpochId, weight)).to.be.rejectedWith("rewardEpochId too low");
  });

  it.skip("Should commit data", async () => {
    let weight = toBN(1000);
    let data = "0x0000000000000000000000000000000000000000000000000000000000000011";
    let rewardEpochId = 1;
    // await voterRegistry.addVoterWeightForRewardEpoch(accounts[1], rewardEpochId, weight);
    await increaseTimeTo(
      firstEpochStartSec.add(
        epochDurationSec.mul(
          currentEpoch.add(
            toBN(REWARD_EPOCH_DURATION + 1)
          )
        )
      ).toNumber()
    );
    let epochId = await votingManager.getCurrentPriceEpochId();
    let tx = await voting.commit(data, { from: accounts[1] });
    console.log(`Commit gas: ${tx.receipt.gasUsed}`);
    // expectEvent(tx, "HashSubmitted", { submitter: accounts[1], epochId: epochId, hash: data });
  });


  it.skip("Should check the gas consumption variants", async () => {
    let data = "0x0000000000000000000000000000000000000000000000000000000000000011";
    let nonce = await web3.eth.getTransactionCount(accounts[1]);
    console.log(`Nonce-1: ${nonce}`)
    let tx = await voting.commit(data, { from: accounts[1] });
    console.log(`Commit gas: ${tx.receipt.gasUsed}`);
    nonce = await web3.eth.getTransactionCount(accounts[1]);
    console.log(`Nonce-2: ${nonce}`)

    // let tx = 
    try {
      await voting.commit(data, { from: accounts[1], gas: 21515 });
      nonce = await web3.eth.getTransactionCount(accounts[1]);
    } catch (e) {
      expect((e as any).message).to.contain("Transaction ran out of gas");
    }

    console.log(`Nonce-3: ${nonce}`)
    let gas = await voting.commit.estimateGas(data, { from: accounts[1]});
    console.log(`Estimated gas: ${gas}`)

    // console.log(`Commit gas: ${tx.receipt.gasUsed}`);
    // expectEvent(tx, "HashSubmitted", { submitter: accounts[1], epochId: epochId, hash: data });
  });

  it.skip("Should reveal data", async () => {
    let weight = toBN(1000);
    let random = ZERO_BYTES32;
    let merkleRoot = ZERO_BYTES32;
    let bitvote = "0x1234567890";
    let prices = "0x001234567890";
    let epochId = await votingManager.getCurrentPriceEpochId();
    let tx = await voting.revealBitvote(random, merkleRoot, bitvote, prices, { from: accounts[1] });
    console.log(`Reveal gas: ${tx.receipt.gasUsed}`);
    // expectEvent(tx, "RevealAndBitvote", { submitter: accounts[1], epochId: epochId.sub(toBN(1)), random, merkleRoot, bitvote, prices });
  });

  


});
