import { deserializeRewardEpochInfo } from "../../libs/ftso-core/src/utils/stat-info/reward-epoch-info";

export interface ShortRewardEpochInfo {
  rewardEpochId: number;
  startVotingRoundId: number;
  endVotingRoundId: number;
  expectedStartVotingRoundId: number;
  expectedEndVotingRoundId: number;
  numberOfVoters: number;
  weights: number[];
}

export function shortRewardEpochInfo(rewardEpochId: number): ShortRewardEpochInfo {
  const info = deserializeRewardEpochInfo(rewardEpochId);
  const result: ShortRewardEpochInfo = {
    rewardEpochId,
    startVotingRoundId: info.signingPolicy.startVotingRoundId,
    endVotingRoundId: info.endVotingRoundId,
    expectedStartVotingRoundId: info.expectedStartVotingRoundId,
    expectedEndVotingRoundId: info.expectedEndVotingRoundId,
    numberOfVoters: info.voterRegistrationInfo.length,
    weights: info.signingPolicy.weights,
  };
  return result;
}

export function shortRewardEpochSummaries(
  startRewardEpochId: number,
  endRewardEpochId: number
): ShortRewardEpochInfo[] {
  const result: ShortRewardEpochInfo[] = [];
  for (let rewardEpochId = startRewardEpochId; rewardEpochId <= endRewardEpochId; rewardEpochId++) {
    result.push(shortRewardEpochInfo(rewardEpochId));
  }
  return result;
}

export function printShortRewardEpochSummaries(summaries: ShortRewardEpochInfo[]) {
  console.log("Reward Epoch Summaries");
  for (const summary of summaries) {
    let delayStartString = "";
    if (summary.startVotingRoundId !== summary.expectedStartVotingRoundId) {
      delayStartString = `(${summary.startVotingRoundId - summary.expectedStartVotingRoundId})`;
    }
    let delayEndString = "";
    if (summary.endVotingRoundId !== summary.expectedEndVotingRoundId) {
      delayEndString = `(${summary.endVotingRoundId - summary.expectedEndVotingRoundId})`;
    }
    console.log(
      `${summary.rewardEpochId}: start: ${summary.startVotingRoundId}${
        delayStartString ? " exp: " + summary.expectedStartVotingRoundId : ""
      }${delayStartString} end: ${summary.endVotingRoundId}${
        delayEndString ? " exp:" + summary.expectedEndVotingRoundId : ""
      }${delayEndString}, Number of Voters: ${summary.numberOfVoters}, Weights: ${summary.weights.join(",")}`
    );
  }
}
