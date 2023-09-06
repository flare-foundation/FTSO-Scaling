import { FTSOClient } from "./FTSOClient";
import { getLogger } from "./utils/logger";
import { sleepFor } from "./time-utils";
import { Received } from "./BlockIndexer";
import { FinalizeData } from "./voting-interfaces";

export class DataProvider {
  private readonly logger = getLogger(DataProvider.name);

  constructor(private client: FTSOClient, private myId: number) {}

  /** Used for checking if we need to send reveals in the current price epoch. */
  private hasCommits: boolean = false;
  /** Tracks reward epochs the data provider is registered as a voter for. */
  private readonly registeredRewardEpochs = new Set<number>();

  async run() {
    await this.client.processNewBlocks(); // Initial catchup.
    this.schedulePriceEpochActions();
  }

  schedulePriceEpochActions() {
    const timeSec = this.currentTimeSec();
    const nextEpochStartSec = this.client.epochs.nextEpochStartSec(timeSec);

    setTimeout(() => {
      this.onPriceEpoch(); // TODO: If this runs for a long time, it might get interleave with the next price epoch - is this a problem?
      this.schedulePriceEpochActions();
    }, (nextEpochStartSec - timeSec + 1) * 1000);
  }

  async onPriceEpoch() {
    const currentEpochId = this.client.epochs.priceEpochIdForTime(this.currentTimeSec());
    const currentRewardEpochId = this.client.epochs.rewardEpochIdForPriceEpochId(currentEpochId);
    this.logger.info(`[${currentEpochId}] Processing price epoch, current reward epoch: ${currentRewardEpochId}.`);

    const previousRewardEpochId = currentRewardEpochId - 1;
    const nextRewardEpochId = currentRewardEpochId + 1;

    if (this.isRegisteredForRewardEpoch(currentRewardEpochId)) {
      await this.maybeScheduleRewardClaiming(previousRewardEpochId, currentEpochId);
      await this.runVotingProcotol(currentEpochId);
    }

    if (!this.isRegisteredForRewardEpoch(nextRewardEpochId) && this.client.rewardEpochOffers.has(nextRewardEpochId)) {
      await this.registerForRewardEpoch(nextRewardEpochId);
    }

    // Process new blocks to make sure we pick up reward offers.
    await this.client.processNewBlocks();
    this.logger.info(`[${currentEpochId}] Finished processing price epoch.`);
  }

  private async maybeScheduleRewardClaiming(previousRewardEpochId: number, currentEpochId: number) {
    if (this.isRegisteredForRewardEpoch(previousRewardEpochId) && this.isFirstPriceEpochInRewardEpoch(currentEpochId)) {
      this.client.indexer.once(Received.Finalize, async (f: string, d: FinalizeData) => {
        this.logger.info(`[${currentEpochId}] Claiming rewards for last reward epoch ${previousRewardEpochId}`);
        await this.client.claimReward(previousRewardEpochId);
      });
    }
  }

  private async runVotingProcotol(currentEpochId: number) {
    this.client.preparePriceFeedsForPriceEpoch(currentEpochId);
    this.logger.info(`[${currentEpochId}] Committing data for current epoch.`);
    await this.client.commit(currentEpochId);

    if (this.hasCommits) {
      const previousEpochId = currentEpochId - 1;
      this.logger.info(`[${currentEpochId}] Revealing data for previous epoch: ${previousEpochId}.`);
      await this.client.reveal(previousEpochId);
      await this.waitForRevealEpochEnd();
      await this.client.processNewBlocks(); // Get reveals
      this.logger.info(`[${currentEpochId}] Calculating results for previous epoch ${previousEpochId} and signing.`);
      await this.client.calculateResultsAndSign(previousEpochId);
      await this.client.tryFinalizeOnceSignaturesReceived(previousEpochId);
    }

    this.hasCommits = true;
  }

  private async registerForRewardEpoch(nextRewardEpochId: number) {
    this.logger.info(`Registering for next reward epoch ${nextRewardEpochId}`);

    if (this.client.rewardCalculator == undefined) this.client.initializeRewardCalculator(nextRewardEpochId);
    this.client.registerRewardsForRewardEpoch(nextRewardEpochId);

    await this.client.registerAsVoter(nextRewardEpochId);

    this.registeredRewardEpochs.add(nextRewardEpochId);
  }

  private isRegisteredForRewardEpoch(epochId: number): boolean {
    return this.registeredRewardEpochs.has(epochId);
  }

  private isFirstPriceEpochInRewardEpoch(epochId: number): boolean {
    const rewardEpoch = this.client.epochs.rewardEpochIdForPriceEpochId(epochId);
    const rewardEpochForPrevious = this.client.epochs.rewardEpochIdForPriceEpochId(epochId - 1);
    return rewardEpochForPrevious != 0 && rewardEpochForPrevious < rewardEpoch;
  }

  private async waitForRevealEpochEnd() {
    const revealPeriodDurationMs = this.client.epochs.revealDurationSec * 1000;
    await sleepFor(revealPeriodDurationMs + 1);
  }
  
  private currentTimeSec(): number {
    return Math.floor(Date.now() / 1000);
  }
}
