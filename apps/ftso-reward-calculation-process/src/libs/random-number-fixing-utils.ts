import { Logger } from "@nestjs/common";
import { encodeParameters } from "web3-eth-abi";
import { soliditySha3 } from "web3-utils";
import {
  deserializeDataForRewardCalculation,
  writeDataForRewardCalculation,
} from "../../../../libs/fsp-rewards/src/utils/stat-info/reward-calculation-data";
import { deserializeRewardEpochInfo } from "../../../../libs/fsp-rewards/src/utils/stat-info/reward-epoch-info";

export function extractRandomNumbers(
  rewardEpochId: number,
  startVotingRoundId: number,
  endVotingRoundId: number
): (bigint | undefined)[] {
  const randomNumbers: (bigint | undefined)[] = [];
  for (let votingRoundId = startVotingRoundId; votingRoundId <= endVotingRoundId; votingRoundId++) {
    const data = deserializeDataForRewardCalculation(rewardEpochId, votingRoundId);
    if (!data) {
      throw new Error(`Missing reward calculation data for voting round ${votingRoundId}`);
    }
    const randomNumberResult = data.nextVotingRoundRandomResult;
    if (randomNumberResult !== undefined) {
      randomNumbers.push(BigInt(data.nextVotingRoundRandomResult!));
    } else {
      randomNumbers.push(undefined);
    }
  }
  return randomNumbers;
}
/**
 * Random number for use in a specific voting round (N) is calculated as a hash of first secure random number
 * in subsequent voting rounds and the voting round id (N).
 * We traverse voting rounds from @param startVotingRoundId to @param endVotingRoundId and fix random numbers
 * for earlier rounds. First voting round that gets fixed is @param startVotingRoundId.
 * The last fixed voting round id is returned (note that it is smaller than @param endVotingRoundId)
 * We assume that all the files for calculation data for rounds from @param startVotingRoundId to @param endVotingRoundId
 * are present.
 */

export function processRandomNumberFixingRange(
  rewardEpochId: number,
  startVotingRoundId: number,
  endVotingRoundId,
  logger: Logger
): number {
  let nextVotingRoundIdWithNoSecureRandom = startVotingRoundId;
  for (let votingRoundId = startVotingRoundId + 1; votingRoundId <= endVotingRoundId; votingRoundId++) {
    const currentCalculationData = deserializeDataForRewardCalculation(rewardEpochId, votingRoundId);
    if (!currentCalculationData) {
      throw new Error(`Missing reward calculation data for voting round ${votingRoundId}`);
    }

    // skip unsecure random
    if (!currentCalculationData.randomResult.isSecure) {
      continue;
    }
    const secureRandom = BigInt(currentCalculationData.randomResult.random);

    while (nextVotingRoundIdWithNoSecureRandom < votingRoundId) {
      const previousCalculationData = deserializeDataForRewardCalculation(
        rewardEpochId,
        nextVotingRoundIdWithNoSecureRandom
      );
      if (!previousCalculationData) {
        throw new Error(
          `Missing reward calculation data for previous voting round ${nextVotingRoundIdWithNoSecureRandom}`
        );
      }
      const newRandomNumber = BigInt(
        soliditySha3(encodeParameters(["uint256", "uint256"], [secureRandom, votingRoundId]))!
      ).toString();
      previousCalculationData.nextVotingRoundRandomResult = newRandomNumber;

      writeDataForRewardCalculation(previousCalculationData);
      logger.log(
        `Fixing random for voting round ${nextVotingRoundIdWithNoSecureRandom} with ${votingRoundId}: ${newRandomNumber}`
      );
      nextVotingRoundIdWithNoSecureRandom++;
    }
  }
  return nextVotingRoundIdWithNoSecureRandom;
}

export async function runRandomNumberFixing(rewardEpochId: number, newEpochVotingRoundOffset: number): Promise<void> {
  const logger = new Logger();
  const rewardEpochInfo = deserializeRewardEpochInfo(rewardEpochId);
  const newRewardEpochId = rewardEpochId + 1;
  const nextRewardEpochInfo = deserializeRewardEpochInfo(rewardEpochId + 1, true);

  let nextVotingRoundIdWithNoSecureRandom = rewardEpochInfo.signingPolicy.startVotingRoundId;
  const startVotingRoundId = rewardEpochInfo.signingPolicy.startVotingRoundId;
  const endVotingRoundId = rewardEpochInfo.endVotingRoundId;

  nextVotingRoundIdWithNoSecureRandom = processRandomNumberFixingRange(
    rewardEpochId,
    startVotingRoundId,
    endVotingRoundId,
    logger
  );

  // Resolve for the future reward epoch
  const newStartVotingRoundId = nextRewardEpochInfo.signingPolicy.startVotingRoundId;

  for (
    let votingRoundId = newStartVotingRoundId;
    votingRoundId < newStartVotingRoundId + newEpochVotingRoundOffset;
    votingRoundId++
  ) {
    const useTempRewardEpochFolder = true;
    const currentCalculationData = deserializeDataForRewardCalculation(
      newRewardEpochId,
      votingRoundId,
      useTempRewardEpochFolder
    );
    if (!currentCalculationData) {
      throw new Error(`Missing reward calculation data for voting round ${votingRoundId}`);
    }
    // skip unsecure random
    if (!currentCalculationData.randomResult.isSecure) {
      continue;
    }
    const secureRandom = BigInt(currentCalculationData.randomResult.random);

    while (nextVotingRoundIdWithNoSecureRandom <= endVotingRoundId) {
      const previousCalculationData = deserializeDataForRewardCalculation(
        rewardEpochId,
        nextVotingRoundIdWithNoSecureRandom
      );
      if (!previousCalculationData) {
        throw new Error(
          `Missing reward calculation data for previous voting round ${nextVotingRoundIdWithNoSecureRandom}`
        );
      }
      const newRandomNumber = BigInt(
        soliditySha3(encodeParameters(["uint256", "uint256"], [secureRandom, votingRoundId]))!
      ).toString();

      previousCalculationData.nextVotingRoundRandomResult = newRandomNumber;

      writeDataForRewardCalculation(previousCalculationData);
      logger.log(
        `Fixing random for voting round ${nextVotingRoundIdWithNoSecureRandom} with ${votingRoundId}: ${newRandomNumber}`
      );

      nextVotingRoundIdWithNoSecureRandom++;
    }
    if (nextVotingRoundIdWithNoSecureRandom > endVotingRoundId) {
      break;
    }
  }
  // If secure random is still not available. The rewards will get burned (indicated by not setting the random number).
}
