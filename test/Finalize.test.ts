import { expectEvent } from "@openzeppelin/test-helpers";
import BN from "bn.js";
import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import { web3 } from "hardhat";
import { VoterRegistryInstance, VotingInstance, VotingManagerInstance } from "../typechain-truffle";
import { getTestFile } from "../test-utils/utils/constants";
import { increaseTimeTo } from "../test-utils/utils/test-helpers";
import { BareSignature } from "../src/voting-interfaces";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { toBN } from "../src/voting-utils";
import { loadAccounts } from "../deployment/tasks/common";

chai.use(chaiBN(BN));

const Voting = artifacts.require("Voting");
const VoterRegistry = artifacts.require("VoterRegistry");
const VotingManager = artifacts.require("VotingManager");


contract(`Voting contracts setup general tests; ${getTestFile(__filename)}`, async () => {
  let voting: VotingInstance;
  let voterRegistry: VoterRegistryInstance;
  let votingManager: VotingManagerInstance;
  let governance: string;
  let currentEpoch: BN;
  const REWARD_EPOCH_DURATION = 10;
  const THRESHOLD = 5000;

  let firstEpochStartSec: BN;
  let epochDurationSec: BN;
  let N = 10;
  let accounts: string[];
  let wallets: any[];

  before(async () => {
    wallets = loadAccounts(web3);
    accounts = wallets.map((wallet) => wallet.address);
    governance = accounts[0];
    let now = Math.floor(Date.now() / 1000);
    await increaseTimeTo(now);
    votingManager = await VotingManager.new(governance);
    voterRegistry = await VoterRegistry.new(governance, votingManager.address, THRESHOLD);
    voting = await Voting.new(voterRegistry.address, votingManager.address);
    currentEpoch = await votingManager.getCurrentPriceEpochId();
    await votingManager.configureRewardEpoch(currentEpoch, REWARD_EPOCH_DURATION);
    await votingManager.configureSigningDuration(180);

    firstEpochStartSec = await votingManager.BUFFER_TIMESTAMP_OFFSET();
    epochDurationSec = await votingManager.BUFFER_WINDOW();

    let weight = toBN(1000);
    let rewardEpochId = 1;

    for(let i = 1; i <= N; i++) {
      await voterRegistry.registerAsAVoter(rewardEpochId, weight, {from: accounts[i]});
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
    let totalWeight = weight.mul(toBN(N));
    let epochId = await voting.getCurrentPriceEpochId();
    expect(await voterRegistry.totalWeightPerRewardEpoch(rewardEpochId)).to.be.bignumber.eq(totalWeight);
    for (let i = 1; i <= N; i++) {
      let sWeight = await voterRegistry.getVoterWeightForRewardEpoch(accounts[i], rewardEpochId)
      // console.log(`${epochId} ${accounts[i]} ${sWeight.toString()}`)
      expect(sWeight).to.be.bignumber.eq(weight);
      expect(await voting.getVoterWeightForPriceEpoch(accounts[i], epochId)).to.be.bignumber.eq(weight);
    }
    expect(await voterRegistry.thresholdForRewardEpoch(rewardEpochId)).to.be.bignumber.eq(totalWeight.mul(toBN(THRESHOLD)).div(toBN(10000)));
  });

  it("Should vote be successful", async () => {
    let epochId = await voting.getCurrentPriceEpochId();
    let currentTime = toBN(await time.latest());

    let signEpochId = epochId;
    let merkleRoot = "0x0000000000000000000000000000000000000000000000000000000000000002";
    let rewardEpochId = await votingManager.getCurrentRewardEpochId();
    console.log(`Current reward epoch id: ${rewardEpochId.toString()}`);
    // assemble signatures
    let signatures: BareSignature[] = [];
    for (let i = 1; i <= N; i++) {
      // console.log(`Signer ${signers[i].address}`);
      // let signature = await signers[i].signMessage(ethers.utils.arrayify(merkleRoot));
      // let sigSplit = ethers.utils.splitSignature(signature);
      let sigSplit = wallets[i].sign(merkleRoot);
      // console.log(sigSplit);
      signatures.push({ v: sigSplit.v, r: sigSplit.r, s: sigSplit.s });
    }

    let tx;
    // tx = await voting.finalize(signEpochId.sub(epochDurationSec.mul(toBN(1))), merkleRoot, signatures, { from: accounts[0] });
    // expectEvent(tx, "MerkleRootConfirmationFailed", { epochId: epochId, merkleRoot }); // no vote power

    await expect(voting.finalize(signEpochId, merkleRoot, signatures, { from: accounts[0] })).to.be.rejectedWith("signing too early");

    await increaseTimeTo(currentTime.add(epochDurationSec.mul(toBN(1))).toNumber());
    await increaseTimeTo(currentTime.add(epochDurationSec.mul(toBN(1))).toNumber());

    tx = await voting.finalize(signEpochId, merkleRoot, signatures, { from: accounts[0] });
    console.log(`Finalize gas used: ${tx.receipt.gasUsed}`);

    expectEvent(tx, "MerkleRootConfirmed", { priceEpochId: epochId, merkleRoot });


    await increaseTimeTo(currentTime.add(epochDurationSec.mul(toBN(6))).toNumber());

    await expect(voting.finalize(signEpochId.sub(toBN(2)), merkleRoot, signatures, { from: accounts[0] })).to.be.rejectedWith("signing too late");

  });


});
