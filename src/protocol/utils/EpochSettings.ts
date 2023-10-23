import { IVotingProvider } from "../../providers/IVotingProvider";

export class EpochSettings {
  constructor(
    readonly firstPriceEpochStartSec: number,
    readonly epochDurationSec: number,
    readonly firstRewardedPriceEpoch: number,
    readonly rewardEpochDurationInEpochs: number
  ) {}

  get revealDurationSec(): number {
    return this.epochDurationSec / 2;
  }

  priceEpochIdForTime(timestampSec: number): number {
    return Math.floor((timestampSec - this.firstPriceEpochStartSec) / this.epochDurationSec);
  }

  revealPriceEpochIdForTime(timestampSec: number): number | undefined {
    let priceEpochId = this.priceEpochIdForTime(timestampSec);
    let revealDeadlineSec =
      this.firstPriceEpochStartSec + priceEpochId * this.epochDurationSec + this.revealDurationSec;
    if (timestampSec > revealDeadlineSec) {
      return undefined;
    }
    return priceEpochId - 1;
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

  nextPriceEpochStartSec(timestampSec: number): number {
    return this.firstPriceEpochStartSec + this.epochDurationSec * (this.priceEpochIdForTime(timestampSec) + 1);
  }

  firstPriceEpochForRewardEpoch(rewardEpochId: number): number {
    return this.firstRewardedPriceEpoch + this.rewardEpochDurationInEpochs * rewardEpochId;
  }

  lastPriceEpochForRewardEpoch(rewardEpochId: number): number {
    return this.firstRewardedPriceEpoch + this.rewardEpochDurationInEpochs * (rewardEpochId + 1) - 1;
  }

  priceEpochStartTimeSec(priceEpochId: number): number {
    return this.firstPriceEpochStartSec + priceEpochId * this.epochDurationSec;
  }

  static fromProvider(provider: IVotingProvider): EpochSettings {
    return new EpochSettings(
      provider.firstEpochStartSec,
      provider.epochDurationSec,
      provider.firstRewardedPriceEpoch,
      provider.rewardEpochDurationInEpochs
    );
  }
}
