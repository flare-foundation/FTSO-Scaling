import { FTSOClient } from "./FTSOClient";
import { getLogger } from "./utils/logger";
import { sleepFor } from "./utils/time";
import { errorString } from "./utils/error";
import { BlockIndexer } from "./BlockIndexer";

export class PriceVoter {
  private readonly logger = getLogger(PriceVoter.name);
  private readonly indexer: BlockIndexer;

  constructor(private client: FTSOClient) {
    this.indexer = client.index as BlockIndexer;
  }

  /** Used for checking if we need to send reveals in the current price epoch. */
  private hasCommits: boolean = false;
  /** Tracks reward epochs the data provider is registered as a voter for. */
  private readonly registeredRewardEpochs = new Set<number>();

  private lastProcessedPriceEpochId?: number;

  async run() {
    this.schedulePriceEpochActions();
    await this.indexer.run();
  }

  schedulePriceEpochActions() {
    const timeSec = this.currentTimeSec();
    const nextEpochStartSec = this.client.epochs.nextPriceEpochStartSec(timeSec);

    setTimeout(async () => {
      this.schedulePriceEpochActions();
      try {
        await this.onPriceEpoch(); // TODO: If this runs for a long time, it might get interleaved with the next price epoch - is this a problem?
      } catch (e) {
        this.logger.error(`Error in price epoch, terminating: ${errorString(e)}`);
        process.exit(1);
      }
    }, (nextEpochStartSec - timeSec + 1) * 1000);
  }

  async onPriceEpoch() {
    const currentPriceEpochId = this.client.epochs.priceEpochIdForTime(this.currentTimeSec());

    if (this.lastProcessedPriceEpochId !== undefined && this.lastProcessedPriceEpochId !== currentPriceEpochId - 1) {
      this.logger.error(
        `Skipped a price epoch. Last processed: ${this.lastProcessedPriceEpochId}, current: ${currentPriceEpochId}. Will to participate in this round.`
      );
      this.hasCommits = false;
    }

    const currentRewardEpochId = this.client.epochs.rewardEpochIdForPriceEpochId(currentPriceEpochId);
    this.logger.info(`[${currentPriceEpochId}] Processing price epoch, current reward epoch: ${currentRewardEpochId}.`);

    const nextRewardEpochId = currentRewardEpochId + 1;

    if (this.isRegisteredForRewardEpoch(currentRewardEpochId)) {
      await this.runVotingProcotol(currentPriceEpochId);
      this.lastProcessedPriceEpochId = currentPriceEpochId;
    }

    await this.maybeRegisterForRewardEpoch(nextRewardEpochId);

    this.logger.info(`[${currentPriceEpochId}] Finished processing price epoch.`);
  }

  private async runVotingProcotol(currentEpochId: number) {
    const priceEpochData = this.client.getPricesForEpoch(currentEpochId);
    this.logger.info(`[${currentEpochId}] Committing data for current epoch.`);
    await this.client.commit(priceEpochData);

    await sleepFor(2000);
    if (this.hasCommits) {
      const previousEpochId = currentEpochId - 1;
      this.logger.info(`[${currentEpochId}] Revealing data for previous epoch: ${previousEpochId}.`);
      await this.client.reveal(priceEpochData);
      await this.waitForRevealEpochEnd();
      this.logger.info(`[${currentEpochId}] Calculating results for previous epoch ${previousEpochId} and signing.`);
      await this.client.calculateResultsAndSign(previousEpochId);
      await this.client.awaitFinalization(previousEpochId);
    }

    this.hasCommits = true;
  }

  private async maybeRegisterForRewardEpoch(nextRewardEpochId: number) {
    if (
      this.isRegisteredForRewardEpoch(nextRewardEpochId) ||
      this.client.index.getRewardOffers(nextRewardEpochId).length === 0
    ) {
      return;
    }
    this.logger.info(`Registering for next reward epoch ${nextRewardEpochId}`);
    await this.client.registerAsVoter(nextRewardEpochId);

    this.registeredRewardEpochs.add(nextRewardEpochId);
  }

  private isRegisteredForRewardEpoch(rewardEpochId: number): boolean {
    return this.registeredRewardEpochs.has(rewardEpochId);
  }

  private async waitForRevealEpochEnd() {
    const revealPeriodDurationMs = this.client.epochs.revealDurationSec * 1000;
    await sleepFor(revealPeriodDurationMs + 1);
  }

  private currentTimeSec(): number {
    return Math.floor(Date.now() / 1000);
  }
}
