export class EpochSettings {
  constructor(
    readonly rewardEpochStartSec: number,
    readonly rewardEpochDurationSec: number,
    readonly firstVotingEpochStartSec: number,
    readonly votingEpochDurationSec: number
  ) {}

  votingEpochForTime(unixMilli: number): number {
    const unixSeconds = Math.floor(unixMilli / 1000);
    return Math.floor((unixSeconds - this.firstVotingEpochStartSec) / this.votingEpochDurationSec);
  }

  nextVotingEpochStartMs(unixMilli: number): number {
    const currentEpoch = this.votingEpochForTime(unixMilli);
    return this.votingEpochStartMs(currentEpoch + 1);
  }

  votingEpochStartMs(epoch: number) {
    return (this.firstVotingEpochStartSec + epoch * this.votingEpochDurationSec) * 1000;
  }

  revealDeadlineSec(epoch: number) {
    return this.votingEpochForTime(epoch) + this.votingEpochDurationSec / 2;
  }

  rewardEpochForTime(unixMilli: number): number {
    const unixSeconds = Math.floor(unixMilli / 1000);
    return Math.floor((unixSeconds - this.rewardEpochStartSec) / this.rewardEpochDurationSec);
  }

  rewardEpochStartMs(epoch: number) {
    return (this.rewardEpochStartSec + epoch * this.rewardEpochDurationSec) * 1000;
  }

  nextRewardEpochStartMs(unixMilli: number): number {
    const currentEpoch = this.rewardEpochForTime(unixMilli);
    const nextEpochStartSec = this.rewardEpochStartSec + (currentEpoch + 1) * this.rewardEpochDurationSec;
    return nextEpochStartSec * 1000;
  }

  rewardEpochForVotingEpoch(epochId: number) {
    const votingEpochStart = this.votingEpochStartMs(epochId);
    return this.rewardEpochForTime(votingEpochStart);
  }
}

// export class EpochSettings {
//   constructor(
//     readonly firstPriceEpochStartSec: number,
//     readonly epochDurationSec: number,
//     readonly firstRewardedPriceEpoch: number,
//     readonly rewardEpochDurationInEpochs: number
//   ) {}

//   get revealDurationSec(): number {
//     return Math.floor(this.epochDurationSec / 2);
//   }

//   priceEpochIdForTime(timestampSec: number): number {
//     return Math.floor((timestampSec - this.firstPriceEpochStartSec) / this.epochDurationSec);
//   }

//   revealPriceEpochIdForTime(timestampSec: number): number | undefined {
//     const priceEpochId = this.priceEpochIdForTime(timestampSec);
//     const revealDeadlineSec =
//       this.firstPriceEpochStartSec + priceEpochId * this.epochDurationSec + this.revealDurationSec;
//     if (timestampSec > revealDeadlineSec) {
//       return undefined;
//     }
//     return priceEpochId - 1;
//   }

//   isLastPriceEpoch(priceEpochId: number): boolean {
//     const current = this.rewardEpochIdForPriceEpochId(priceEpochId);
//     if (current == 0) return true;

//     return current != this.rewardEpochIdForPriceEpochId(priceEpochId + 1);
//   }

//   rewardEpochIdForPriceEpochId(priceEpochId: number): number {
//     if (priceEpochId < this.firstRewardedPriceEpoch) {
//       return 0;
//     }
//     return Math.floor((priceEpochId - this.firstRewardedPriceEpoch) / this.rewardEpochDurationInEpochs);
//   }

//   nextPriceEpochStartSec(timestampSec: number): number {
//     return this.firstPriceEpochStartSec + this.epochDurationSec * (this.priceEpochIdForTime(timestampSec) + 1);
//   }

//   firstPriceEpochForRewardEpoch(rewardEpochId: number): number {
//     return this.firstRewardedPriceEpoch + this.rewardEpochDurationInEpochs * rewardEpochId;
//   }

//   lastPriceEpochForRewardEpoch(rewardEpochId: number): number {
//     return this.firstRewardedPriceEpoch + this.rewardEpochDurationInEpochs * (rewardEpochId + 1) - 1;
//   }

//   priceEpochStartTimeSec(priceEpochId: number): number {
//     return this.firstPriceEpochStartSec + priceEpochId * this.epochDurationSec;
//   }

//   revealDeadlineSec(priceEpochId: number): number {
//     return this.priceEpochStartTimeSec(priceEpochId) + this.revealDurationSec;
//   }
// }
