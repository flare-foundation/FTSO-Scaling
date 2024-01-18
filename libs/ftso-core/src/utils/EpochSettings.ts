export class EpochSettings {
  constructor(
    readonly firstVotingRoundStartTs: number,
    readonly votingEpochDurationSeconds: number,
    readonly firstRewardEpochStartVotingRoundId: number,
    readonly rewardEpochDurationInVotingEpochs: number,
    readonly revealDeadlineSeconds: number,
  ) { }

  votingEpochForTimeSec(unixSeconds: number): number {
    return Math.floor((unixSeconds - this.firstVotingRoundStartTs) / this.votingEpochDurationSeconds);
  }

  votingEpochForTime(unixMilli: number): number {
    const unixSeconds = Math.floor(unixMilli / 1000);
    return this.votingEpochForTimeSec(unixSeconds);
  }

  nextVotingEpochStartMs(unixMilli: number): number {
    const currentEpoch = this.votingEpochForTime(unixMilli);
    return this.votingEpochStartMs(currentEpoch + 1);
  }

  votingEpochStartSec(votingEpochId: number): number {
    return this.firstVotingRoundStartTs + votingEpochId * this.votingEpochDurationSeconds;
  }

  votingEpochStartMs(votingEpochId: number): number {
    return this.votingEpochStartSec(votingEpochId) * 1000;
  }

  votingEpochEndSec(votingEpochId: number): number {
    // The interval is semi open [startTime, endTime = startTime (for next epoch)) 
    // Start time is included, but end time is not, so this is actual closed interval 
    return this.votingEpochStartSec(votingEpochId + 1) - 1
  }

  revealDeadlineSec(votingEpochId: number): number {
    // The interval is semi open [startTime, startTime + revealDeadlineSeconds)
    return this.votingEpochStartSec(votingEpochId) + this.revealDeadlineSeconds - 1;
  }

  expectedFirstVotingRoundForRewardEpoch(rewardEpochId: number) {
    return this.firstRewardEpochStartVotingRoundId + rewardEpochId * this.rewardEpochDurationInVotingEpochs;
  }

  expectedRewardEpochStartTimeSec(rewardEpochId: number) {
    return this.votingEpochStartSec(this.expectedFirstVotingRoundForRewardEpoch(rewardEpochId));
  }

  rewardEpochForTime(unixMilli: number): number {
    const votingEpochId = this.votingEpochForTime(unixMilli);
    return this.expectedFirstVotingRoundForRewardEpoch(votingEpochId);
  }

  expectedRewardEpochForVotingEpoch(votingEpochId: number) {
    if (votingEpochId < this.firstRewardEpochStartVotingRoundId) {
      throw new Error(`votingEpochId ${votingEpochId} is before firstRewardEpochStartVotingRoundId ${this.firstRewardEpochStartVotingRoundId}`);
    }
    return Math.floor((votingEpochId - this.firstRewardEpochStartVotingRoundId) / this.rewardEpochDurationInVotingEpochs)
  }
}
