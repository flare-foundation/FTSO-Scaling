import BN from "bn.js";
import { increaseTimeTo } from "./test-helpers";
import { VotingManagerInstance } from "../../typechain-truffle";
import { toBN } from "../../src/protocol/utils/voting-utils";

/**
 * Moves time to the start of the next price epoch, relative to the position in the current price epoch.
 * @param votingManager
 */
export async function moveToNextPriceEpochStart(votingManager: VotingManagerInstance) {
  const firstEpochStartSec = await votingManager.BUFFER_TIMESTAMP_OFFSET();
  const epochDurationSec = await votingManager.BUFFER_WINDOW();

  const currentPriceEpochId = await votingManager.getCurrentPriceEpochId();
  const time = firstEpochStartSec.add(epochDurationSec.mul(currentPriceEpochId.add(toBN(1)))).toNumber();
  await increaseTimeTo(time);
}

/**
 * Moves time to the end of the reveal time in the current price epoch.
 * @param votingManager
 */
export async function moveToCurrentPriceEpochRevealEnd(votingManager: VotingManagerInstance) {
  const firstEpochStartSec = await votingManager.BUFFER_TIMESTAMP_OFFSET();
  const epochDurationSec = await votingManager.BUFFER_WINDOW();

  let time;
  const currentEpoch = await votingManager.getCurrentPriceEpochId();
  time = firstEpochStartSec
    .add(epochDurationSec.mul(currentEpoch))
    .add(epochDurationSec.div(toBN(2)).add(toBN(1)))
    .toNumber();
  await increaseTimeTo(time);
}

/**
 * Moves time to the start of the next reward epoch, relative to the position in the current price epoch.
 * @param votingManager
 * @param firstRewardedPriceEpoch
 * @param rewardEpochDurationInEpochs
 */
export async function moveToNextRewardEpochStart(
  votingManager: VotingManagerInstance,
  firstRewardedPriceEpoch: BN,
  rewardEpochDurationInEpochs: number
) {
  const firstEpochStartSec = await votingManager.BUFFER_TIMESTAMP_OFFSET();
  const epochDurationSec = await votingManager.BUFFER_WINDOW();

  const currentRewardEpochId = await votingManager.getCurrentRewardEpochId();
  const time = firstEpochStartSec
    .add(
      epochDurationSec.mul(
        firstRewardedPriceEpoch.add(toBN(rewardEpochDurationInEpochs).mul(currentRewardEpochId.add(toBN(1))))
      )
    )
    .toNumber();
  await increaseTimeTo(time);
}
