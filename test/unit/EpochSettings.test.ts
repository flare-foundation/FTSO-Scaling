import { VotingManagerInstance } from "../../typechain-truffle";
import { getTestFile } from "../../test-utils/constants";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { EpochSettings } from "../../src/protocol/utils/EpochSettings";
import Prando from "prando";

const VotingManager = artifacts.require("VotingManager");

contract(`EpochSettings; ${getTestFile(__filename)}`, async accounts => {
  const governance = accounts[0];
  const REWARD_EPOCH_DURATION = 10;

  const rng = new Prando(123); // We want deterministic random for reproducible tests

  let votingManager: VotingManagerInstance;
  let firstRewardedEpoch: number;

  let firstEpochStartSec: number;
  let epochDurationSec: number;

  let epochSettings: EpochSettings;
  let initialTimestampSec: number;

  before(async () => {
    initialTimestampSec = await time.latest();
    votingManager = await VotingManager.new(governance);
    firstRewardedEpoch = (await votingManager.getCurrentPriceEpochId()).toNumber();
    await votingManager.configureRewardEpoch(firstRewardedEpoch, REWARD_EPOCH_DURATION);

    firstEpochStartSec = (await votingManager.BUFFER_TIMESTAMP_OFFSET()).toNumber();
    epochDurationSec = (await votingManager.BUFFER_WINDOW()).toNumber();

    epochSettings = new EpochSettings(firstEpochStartSec, epochDurationSec, firstRewardedEpoch, REWARD_EPOCH_DURATION);
  });

  it("Should return correct current price epoch", async () => {
    const N = 100;

    for (let i = 1; i <= N; i++) {
      const randomTimeDiff = rng.nextInt(1, epochDurationSec);
      await time.increase(randomTimeDiff);

      const now = await time.latest();
      const calculatedPriceEpoch = epochSettings.priceEpochIdForTime(now);
      const realPriceEpoch = (await votingManager.getCurrentPriceEpochId()).toNumber();
      expect(calculatedPriceEpoch).to.equal(realPriceEpoch, "Price epoch doesn't match smart contract.");
    }
  });

  it("Should return correct reward epoch for price epoch", async () => {
    const N = 100;

    for (let i = 1; i <= N; i++) {
      const randomTimeDiff = rng.nextInt(1, epochDurationSec * REWARD_EPOCH_DURATION);
      await time.increase(randomTimeDiff);

      const now = await time.latest();
      const currentPriceEpoch = epochSettings.priceEpochIdForTime(now);
      const calculatedRewardEpoch = epochSettings.rewardEpochIdForPriceEpochId(currentPriceEpoch);
      const realRewardEpoch = (await votingManager.getCurrentRewardEpochId()).toNumber();
      expect(calculatedRewardEpoch).to.equal(realRewardEpoch, "Reward epoch doesn't match smart contract.");
    }
  });

  it("Should return correct last price epoch for reward epoch", async () => {
    const N = 100;

    for (let rewardEpoch = 0; rewardEpoch <= N; rewardEpoch++) {
      const realLastPriceEpoch = (await votingManager.lastPriceEpochOfRewardEpoch(rewardEpoch)).toNumber();
      const calculatedLastPriceEpoch = epochSettings.lastPriceEpochForRewardEpoch(rewardEpoch);
      expect(calculatedLastPriceEpoch).to.equal(realLastPriceEpoch, "Last price epoch doesn't match smart contract.");
    }
  });
});
