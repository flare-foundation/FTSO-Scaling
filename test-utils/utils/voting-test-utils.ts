import BN from "bn.js";
import { increaseTimeTo } from "./test-helpers";
import { VotingManagerInstance } from "../../typechain-truffle";
import { toBN } from "../../src/voting-utils";

/**
 * Moves time to the start of the next price epoch, relative to the position in the current price epoch.
 * @param votingManager
 */
export async function moveToNextPriceEpochStart(votingManager: VotingManagerInstance) {
  let firstEpochStartSec = await votingManager.BUFFER_TIMESTAMP_OFFSET();
  let epochDurationSec = await votingManager.BUFFER_WINDOW();

  let currentPriceEpochId = await votingManager.getCurrentPriceEpochId();
  let time = firstEpochStartSec.add(
    epochDurationSec.mul(
      currentPriceEpochId.add(
        toBN(1)
      )
    )
  ).toNumber();
  await increaseTimeTo(time);
}

/**
 * Moves time to the end of the reveal time in the current price epoch.
 * @param votingManager 
 */
export async function moveToCurrentRewardEpochRevealEnd(votingManager: VotingManagerInstance) {
  let firstEpochStartSec = await votingManager.BUFFER_TIMESTAMP_OFFSET();
  let epochDurationSec = await votingManager.BUFFER_WINDOW();

  let time;
  let currentEpoch = await votingManager.getCurrentPriceEpochId();
  time = firstEpochStartSec.add(
    epochDurationSec.mul(
      currentEpoch
    )
  ).add(epochDurationSec.div(toBN(2)).add(toBN(1))).toNumber();
  await increaseTimeTo(time);
}

/**
 * Moves time to the start of the next reward epoch, relative to the position in the current price epoch.
 * @param votingManager 
 * @param firstRewardedPriceEpoch 
 * @param rewardEpochDurationInEpochs 
 */
export async function moveToNextRewardEpochStart(votingManager: VotingManagerInstance, firstRewardedPriceEpoch: BN, rewardEpochDurationInEpochs: number) {
  let firstEpochStartSec = await votingManager.BUFFER_TIMESTAMP_OFFSET();
  let epochDurationSec = await votingManager.BUFFER_WINDOW();

  let currentRewardEpochId = await votingManager.getCurrentRewardEpochId();
  let time = firstEpochStartSec.add(
    epochDurationSec.mul(
      firstRewardedPriceEpoch.add(
        toBN(rewardEpochDurationInEpochs).mul(currentRewardEpochId.add(toBN(1)))
      )
    )
  ).toNumber();
  await increaseTimeTo(time);
}
