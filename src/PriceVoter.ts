import { FTSOClient } from "./protocol/FTSOClient";
import { getLogger } from "./utils/logger";
import { randomDelay, runWithDuration, sleepFor } from "./utils/time";
import { asError, errorString } from "./protocol/utils/error";
import { EpochSettings } from "./protocol/utils/EpochSettings";
import { EpochData } from "./protocol/voting-types";
import { TimeoutError, promiseWithTimeout } from "./utils/retry";
import { BlockIndex } from "./protocol/BlockIndex";

export class PriceVoter {
  private readonly logger = getLogger(PriceVoter.name);

  constructor(
    private readonly client: FTSOClient,
    private readonly index: BlockIndex,
    private readonly epochs: EpochSettings
  ) {}

  private previousPriceEpochData: EpochData | undefined;
  /** Tracks reward epochs the data provider is registered as a voter for. */
  private readonly registeredRewardEpochs = new Set<number>();

  private lastProcessedPriceEpochId?: number;

  async run() {
    this.schedulePriceEpochActions();
  }

  schedulePriceEpochActions() {
    const timeSec = this.currentTimeSec();
    const nextEpochStartSec = this.epochs.nextPriceEpochStartSec(timeSec);

    setTimeout(async () => {
      this.schedulePriceEpochActions();
      try {
        await this.onPriceEpoch(nextEpochStartSec + this.epochs.epochDurationSec); // TODO: If this runs for a long time, it might get interleaved with the next price epoch - is this a problem?
      } catch (e) {
        this.logger.error(`Error in price epoch, terminating: ${errorString(e)}`);
        process.exit(1);
      }
    }, (nextEpochStartSec - timeSec + 1) * 1000);
  }

  async onPriceEpoch(epochDeadlineSec: number) {
    const currentPriceEpochId = this.epochs.priceEpochIdForTime(this.currentTimeSec());

    if (this.lastProcessedPriceEpochId !== undefined && this.lastProcessedPriceEpochId !== currentPriceEpochId - 1) {
      this.logger.error(
        `Skipped a price epoch. Last processed: ${this.lastProcessedPriceEpochId}, current: ${currentPriceEpochId}. Will to participate in this round.`
      );
      this.previousPriceEpochData = undefined;
    }

    const currentRewardEpochId = this.epochs.rewardEpochIdForPriceEpochId(currentPriceEpochId);
    this.logger.info(`[${currentPriceEpochId}] Processing price epoch, current reward epoch: ${currentRewardEpochId}.`);

    const nextRewardEpochId = currentRewardEpochId + 1;

    if (this.isRegisteredForRewardEpoch(currentRewardEpochId)) {
      await runWithDuration(
        "VOTING_ROUND",
        async () => await this.runVotingProcotol(currentPriceEpochId, epochDeadlineSec)
      );
      this.lastProcessedPriceEpochId = currentPriceEpochId;
    }

    await this.maybeRegisterForRewardEpoch(nextRewardEpochId);

    this.logger.info(`[${currentPriceEpochId}] Finished processing price epoch.`);
  }

  private async runVotingProcotol(currentEpochId: number, epochDeadlineSec: number) {
    await randomDelay(0, 2000); // Random delay to avoid transaction contention.
    const priceEpochData = this.client.getPricesForEpoch(currentEpochId);
    this.logger.info(`[${currentEpochId}] Committing data for current epoch.`);
    await runWithDuration("COMMIT", async () => await this.client.commit(priceEpochData));

    await sleepFor(2000);
    if (this.previousPriceEpochData !== undefined) {
      const previousEpochId = currentEpochId - 1;
      this.logger.info(`[${currentEpochId}] Revealing data for previous epoch: ${previousEpochId}.`);
      await runWithDuration("REVEAL", async () => await this.client.reveal(this.previousPriceEpochData!));
      await this.waitForRevealEpochEnd();

      this.logger.info(`[${currentEpochId}] Calculating results for previous epoch ${previousEpochId} and signing.`);
      const result = await this.client.calculateResults(previousEpochId);
      await randomDelay(0, 2000);
      await runWithDuration("RESULTS", async () => await this.client.signResult(previousEpochId, result));

      await runWithDuration("FINALIZATION", async () => await this.awaitFinalizationOrTimeout(previousEpochId));
      if (this.currentTimeSec() > epochDeadlineSec) {
        this.logger.warn(
          `Finalization happened outside price epoch window: ${this.currentTimeSec()} > ${epochDeadlineSec}`
        );
      }
      await randomDelay(0, 1000);
      await runWithDuration("PUBLISH", async () => await this.client.publishPrices(result, [0, 1]));
    }
    this.previousPriceEpochData = priceEpochData;
  }

  private async awaitFinalizationOrTimeout(priceEpochId: number) {
    try {
      await promiseWithTimeout(this.awaitFinalization(priceEpochId), 30_000);
    } catch (e) {
      const error = asError(e);
      if (e instanceof TimeoutError) {
        this.logger.error(`[${priceEpochId}] Timed out waiting for finalization.`);
        throw error;
      }
    }
  }

  private async awaitFinalization(priceEpochId: number) {
    while (!this.index.getFinalize(priceEpochId)) {
      this.logger.info(`Epoch ${priceEpochId} not finalized, keep processing new blocks`);
      await sleepFor(500);
    }
    this.logger.info(`Epoch ${priceEpochId} finalized, continue.`);
  }

  private async maybeRegisterForRewardEpoch(nextRewardEpochId: number) {
    if (
      this.isRegisteredForRewardEpoch(nextRewardEpochId) ||
      this.index.getRewardOffers(nextRewardEpochId).length === 0
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
    const revealPeriodDurationMs = this.epochs.revealDurationSec * 1000;
    await sleepFor(revealPeriodDurationMs + 1);
  }

  private currentTimeSec(): number {
    return Math.floor(Date.now() / 1000);
  }
}
