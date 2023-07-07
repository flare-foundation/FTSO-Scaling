import BN from "bn.js";
import chai from "chai";
import chaiBN from "chai-bn";
import { getTestFile } from "../test-utils/utils/constants";
import { increaseTimeTo, toBN } from "../test-utils/utils/test-helpers";
import { VoterRegistryInstance, VotingInstance, VotingManagerInstance } from "../typechain-truffle";
chai.use(chaiBN(BN));

const Voting = artifacts.require("Voting");
const VoterRegistry = artifacts.require("VoterRegistry");
const VotingManager = artifacts.require("VotingManager");

contract(`Hash test; ${getTestFile(__filename)}`, async accounts => {
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
    currentEpoch = await votingManager.getCurrentPriceEpochId();
    await votingManager.configureRewardEpoch(currentEpoch, REWARD_EPOCH_DURATION);

    firstEpochStartSec = await votingManager.BUFFER_TIMESTAMP_OFFSET();
    epochDurationSec = await votingManager.BUFFER_WINDOW();

    let weight = toBN(1000);
    let rewardEpochId = 1;
    let N = 10;

    let allWeights = new Array(N).fill(weight);
    await voterRegistry.addVotersWithWeightsForRewardEpoch(rewardEpochId, accounts.slice(1, N + 1), allWeights);

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

  // it("Should test hashes", async () => {
  //   // let random = web3.utils.randomHex(length);
  //   let random = "0x1c781595788548f1a02beb1b262b7eab3a415def6b95212b6c359eae07afec23";
  //   let merkleRoot = "0x1100000000000000000000000000000000000000000000000000000000000000";

  //   async function compareHashes(prices: string) {
  //     let hash = await voting.hashForCommit(accounts[0], random, merkleRoot, prices);
  //     let hash2 = hashForCommit(accounts[0], random, merkleRoot, prices);
  //     assert(hash === hash2, "Hashes are not equal")  
  //   }

  //   await compareHashes("0x1100000000000000000000000000000000000000000000000000000000000022");  // 32 byte
  //   await compareHashes("0x110000000000000000000000000000000000000022");  // shorter
  //   await compareHashes("0x11000000000000000000000000000000000000000000000000000000000000221234");  // longer
  //   await compareHashes("0x11000000000000000000000000000000000000000000000000000000000000221100000000000000000000000000000000000000000000000000000000000022");  // double length
  //   await compareHashes("0x1100000000000000000000000000000000000000000000000000000000000022110000000000000000000000000000000000000000000000000000000022");  // double a bit less
  //   await compareHashes("0x110000000000000000000000000000000000000000000000000000000000002211000000000000000000000000000000000000000000000000000000000000221234");  // double length a bit more

  // });

});
