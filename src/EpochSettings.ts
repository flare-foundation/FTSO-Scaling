export class EpochSettings {
  constructor(
    readonly firstEpochStartSec: number,
    readonly epochDurationSec: number,
    readonly firstRewardedPriceEpoch: number,
    readonly rewardEpochDurationInEpochs: number
  ) {}

  get revealDurationSec(): number {
    return this.epochDurationSec / 2;
  }

  priceEpochIdForTime(timestampSec: number): number {
    return Math.floor((timestampSec - this.firstEpochStartSec) / this.epochDurationSec);
  }

  revealEpochIdForTime(timestampSec: number): number | undefined {
    let epochId = this.priceEpochIdForTime(timestampSec);
    let revealDeadlineSec = this.firstEpochStartSec + epochId * this.epochDurationSec + this.revealDurationSec;
    if (timestampSec > revealDeadlineSec) {
      return undefined;
    }
    return epochId - 1;
  }

  isLastPriceEpoch(priceEpochId: number): boolean {
    const current = this.rewardEpochIdForPriceEpochId(priceEpochId);
    if (current == 0) return true;

    return current != this.rewardEpochIdForPriceEpochId(priceEpochId + 1);
  }

  rewardEpochIdForPriceEpochId(priceEpochId: number): number {
    if (priceEpochId < this.firstRewardedPriceEpoch) {
      return 0;
    }
    return Math.floor((priceEpochId - this.firstRewardedPriceEpoch) / this.rewardEpochDurationInEpochs);
  }

  nextEpochStartSec(timestampSec: number): number {
    return this.firstEpochStartSec + this.epochDurationSec * (this.priceEpochIdForTime(timestampSec) + 1);
  }

  firstPriceEpochForRewardEpoch(rewardEpochId: number): number {
    return this.firstRewardedPriceEpoch + this.rewardEpochDurationInEpochs * rewardEpochId;
  }

  lastPriceEpochForRewardEpoch(rewardEpochId: number): number {
    return this.firstRewardedPriceEpoch + this.rewardEpochDurationInEpochs * (rewardEpochId + 1) - 1;
  }
}
