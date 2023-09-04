import { FTSOClient } from "./FTSOClient";
import { getLogger } from "./utils/logger";
import { sleepFor } from "./time-utils";
import { Received } from "./BlockIndexer";
import { FinalizeData } from "./voting-interfaces";

export class DataProvider {
  private readonly logger = getLogger(DataProvider.name);
  private static readonly BLOCK_PROCESSING_INTERVAL_MS = 500;

  constructor(private client: FTSOClient, private myId: number) {}

  /** Used for checking if we need to send reveals in the current price epoch. */
  private hasCommits: boolean = false;
  /** Tracks reward epochs the data provider is registered as a voter for. */
  private readonly registeredRewardEpochs = new Set<number>();

  async run() {
    await this.client.processNewBlocks(); // Initial catchup.
    this.keepProcessingNewBlocks();
    this.schedulePriceEpochActions();
  }

  private async keepProcessingNewBlocks() {
    while (true) {
      await this.client.processNewBlocks();
      await sleepFor(DataProvider.BLOCK_PROCESSING_INTERVAL_MS);
    }
  }


  schedulePriceEpochActions() {
    const timeSec = Math.floor(Date.now() / 1000); // this.client.blockchainTime();
    const nextEpochStartSec = this.client.epochs.nextEpochStartSec(timeSec);

    setTimeout(() => {
      this.onPriceEpoch();
      this.schedulePriceEpochActions();
    }, (nextEpochStartSec - timeSec + 1) * 1000);
  }

  async onPriceEpoch() {
    const currentEpochId = this.client.epochs.priceEpochIdForTime(Math.floor(Date.now() / 1000));
    const currentRewardEpochId = this.client.epochs.rewardEpochIdForPriceEpochId(currentEpochId);

    this.logger.info(`[On price epoch] ${currentEpochId}, reward epoch ${currentRewardEpochId}.`);

    const previousRewardEpochId = currentRewardEpochId - 1;
    const nextRewardEpochId = currentRewardEpochId + 1;

    if (this.isRegisteredForRewardEpoch(currentRewardEpochId)) {
      await this.maybeScheduleRewardClaiming(previousRewardEpochId, currentEpochId);
      await this.runVotingProcotol(currentEpochId);
    }

    if (!this.isRegisteredForRewardEpoch(nextRewardEpochId) && this.client.rewardEpochOffers.has(nextRewardEpochId)) {
      await this.registerForRewardEpoch(nextRewardEpochId);
    }
  }

  private async maybeScheduleRewardClaiming(previousRewardEpochId: number, currentEpochId: number) {
    if (this.isRegisteredForRewardEpoch(previousRewardEpochId) && this.isFirstPriceEpochInRewardEpoch(currentEpochId)) {
      this.client.indexer.once(Received.Finalize, async (f: string, d: FinalizeData) => {
        this.logger.info(`Claiming rewards for last reward epoch ${previousRewardEpochId}`);
        await this.client.claimReward(previousRewardEpochId);
      });
    }
  }

  private async runVotingProcotol(currentEpochId: number) {
    this.client.clearSignatureListener(); // Clear listeners from previous epoch.

    this.logger.info(`[Voting] On commit for current ${currentEpochId}`);
    this.client.preparePriceFeedsForPriceEpoch(currentEpochId);
    await this.client.commit(currentEpochId);

    if (this.hasCommits) {
      this.client.listenForSignatures();
      const previousEpochId = currentEpochId - 1;
      this.logger.info(`[Voting] On reveal for previous ${previousEpochId}`);
      await this.client.reveal(previousEpochId);
      await this.waitForRevealEpochEnd();
      this.logger.info(`[Voting] Calculate results and on sign prev ${previousEpochId}`);

      await this.client.sign(previousEpochId);
      await this.client.tryFinalizeOnceSignaturesReceived(previousEpochId);
    }

    this.hasCommits = true;
    this.logger.info("[Voting] End round");
  }

  private async registerForRewardEpoch(nextRewardEpochId: number) {
    this.logger.info(`Registering for reward epoch ${nextRewardEpochId}`);

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
}
