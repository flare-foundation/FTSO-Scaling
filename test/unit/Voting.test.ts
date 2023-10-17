import { expectEvent } from "@openzeppelin/test-helpers";
import BN from "bn.js";
import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import { web3 } from "hardhat";
import { VotingInstance } from "../../typechain-truffle";
import { getTestFile } from "../../test-utils/utils/constants";
import { increaseTimeTo } from "../../test-utils/utils/test-helpers";
import { BareSignature } from "../../src/protocol/voting-types";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { toBN } from "../../src/protocol/voting-utils";
import { loadAccounts } from "../../deployment/tasks/common";
import { Account } from "web3-core";
import { moveToNextRewardEpochStart } from "../../test-utils/utils/voting-test-utils";

chai.use(chaiBN(BN));

const Voting = artifacts.require("Voting");
const VoterRegistry = artifacts.require("VoterRegistry");
const VotingManager = artifacts.require("VotingManager");

const NUM_ACCOUNTS = 10;
const REWARD_EPOCH_DURATION = 10;
const THRESHOLD = 5000;
const TEST_REWARD_EPOCH = 1;
const VOTER_WEIGHT = toBN(1000);

contract(`Voting.sol; ${getTestFile(__filename)}`, async () => {
  let voting: VotingInstance;
  let epochDurationSec: BN;
  let accounts: Account[];

  before(async () => {
    accounts = loadAccounts(web3);
    const governance = accounts[0].address;
    const votingManager = await VotingManager.new(governance);
    const voterRegistry = await VoterRegistry.new(governance, votingManager.address, THRESHOLD);
    voting = await Voting.new(voterRegistry.address, votingManager.address);
    const currentPriceEpoch = await votingManager.getCurrentPriceEpochId();
    await votingManager.configureRewardEpoch(currentPriceEpoch, REWARD_EPOCH_DURATION);
    await votingManager.configureSigningDuration(180);

    epochDurationSec = await votingManager.BUFFER_WINDOW();

    for (let i = 1; i <= NUM_ACCOUNTS; i++) {
      await voterRegistry.registerAsAVoter(TEST_REWARD_EPOCH, VOTER_WEIGHT, { from: accounts[i].address });
    }
    await moveToNextRewardEpochStart(votingManager, currentPriceEpoch, REWARD_EPOCH_DURATION);
  });

  it("Should finalize correctly", async () => {
    const finalizer = accounts[1].address;
    const epochId = await voting.getCurrentPriceEpochId();
    const currentTime = toBN(await time.latest());

    const signEpochId = epochId;
    const merkleRoot = "0x0000000000000000000000000000000000000000000000000000000000000002";
    const signatures: BareSignature[] = [];
    for (let i = 1; i <= NUM_ACCOUNTS; i++) {
      const sigSplit = accounts[i].sign(merkleRoot);
      signatures.push({ v: parseInt(sigSplit.v, 16), r: sigSplit.r, s: sigSplit.s });
    }

    await expect(voting.finalize(signEpochId, merkleRoot, signatures, { from: finalizer })).to.be.rejectedWith(
      "signing too early"
    );

    await increaseTimeTo(currentTime.add(epochDurationSec.mul(toBN(1))).toNumber());
    await increaseTimeTo(currentTime.add(epochDurationSec.mul(toBN(1))).toNumber());

    const notEnoughSignatures = signatures.slice(0, 1);
    const tx1 = await voting.finalize(signEpochId, merkleRoot, notEnoughSignatures, { from: finalizer });
    expectEvent(tx1, "MerkleRootConfirmationFailed", { priceEpochId: epochId, merkleRoot });

    const tx2 = await voting.finalize(signEpochId, merkleRoot, signatures, { from: finalizer });
    expectEvent(tx2, "MerkleRootConfirmed", { priceEpochId: epochId, merkleRoot });

    await increaseTimeTo(currentTime.add(epochDurationSec.mul(toBN(6))).toNumber());
    await expect(
      voting.finalize(signEpochId.sub(toBN(2)), merkleRoot, signatures, { from: finalizer })
    ).to.be.rejectedWith("signing too late");
  });
});
