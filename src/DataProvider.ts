import { FTSOClient } from "./FTSOClient";
import { getLogger } from "./utils/logger";
import { sleepFor } from "./time-utils";

export class DataProvider {
  private static readonly BLOCK_PROCESSING_INTERVAL_MS = 500;

  constructor(private client: FTSOClient, private myId: number) {}

  private readonly logger = getLogger(DataProvider.name); 

  /** Used for checking if we need to send reveals in the current price epoch. */
  private hasCommits: boolean = false;
  /** Tracks reward epochs the data provider is registered as a voter for. */
  private readonly registeredRewardEpochs = new Set<number>();

  async run() {
    const currentBlock = await this.client.provider.getBlockNumber();
    this.client.initialize(currentBlock);
    this.processBlocks();
    this.schedulePriceEpochActions();
  }

  private async processBlocks() {
    while (true) {
      await this.client.processNewBlocks();
      await sleepFor(DataProvider.BLOCK_PROCESSING_INTERVAL_MS);
    }
  }

  schedulePriceEpochActions() {
    const timeSec = Date.now() / 1000;
    const nextEpochStartSec = this.client.epochs.nextEpochStartSec(timeSec);

    setTimeout(() => {
      this.onPriceEpoch();
      this.schedulePriceEpochActions();
    }, (nextEpochStartSec - timeSec + 1) * 1000);
  }

  async onPriceEpoch() {
    const currentEpochId = this.client.epochs.priceEpochIdForTime(Date.now() / 1000);
    const currentRewardEpochId = this.client.epochs.rewardEpochIdForPriceEpochId(currentEpochId);

    this.logger.info(`[On price epoch] ${currentEpochId}, reward epoch ${currentRewardEpochId}.`);

    const previousRewardEpochId = currentRewardEpochId - 1;
    const nextRewardEpochId = currentRewardEpochId + 1;

    if (this.isRegisteredForRewardEpoch(currentRewardEpochId)) {
      await this.runVotingProcotol(currentEpochId);
      if (
        this.isRegisteredForRewardEpoch(previousRewardEpochId) &&
        this.isFirstPriceEpochInRewardEpoch(currentEpochId)
      ) {
        this.logger.info(`Claiming rewards for last reward epoch ${previousRewardEpochId}`);
        // TODO: We need something more robust than sleeping, ideally should listen for a finalization
        //       event and then trigger the claiming logic.
        await sleepFor(5000); // Wait for finalization to happen - only one provider performs it
        await this.client.claimReward(previousRewardEpochId);
      }
    }

    if (!this.isRegisteredForRewardEpoch(nextRewardEpochId) && this.client.rewardEpochOffers.has(nextRewardEpochId)) {
      await this.registerForRewardEpoch(nextRewardEpochId);
    }
  }

  private async runVotingProcotol(currentEpochId: number) {
    this.logger.info(`[Voting] On commit for current ${currentEpochId}`);
    this.client.preparePriceFeedsForPriceEpoch(currentEpochId);
    await this.client.onCommit(currentEpochId);

    if (this.hasCommits) {
      const previousEpochId = currentEpochId - 1;
      this.logger.info(`[Voting] On reveal for previous ${previousEpochId}`);
      await this.client.onReveal(previousEpochId);
      await this.waitForRevealEpochEnd();
      this.logger.info(`[Voting] Calculate results and on sign prev ${previousEpochId}`);
      await this.client.onSign(previousEpochId);
      await sleepFor(2000); // Wait for others' signatures.
      if (this.shouldFinalize()) {
        this.logger.info(`[Voting] Send signatures for prev ${previousEpochId}`);
        await this.client.onSendSignaturesForMyMerkleRoot(previousEpochId);
      }
    }

    this.hasCommits = true;
    this.logger.info("[[[[[[End voting protocol]]]]]");
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

  /** Placeholder – the first data provider performs finalization. */
  private shouldFinalize() {
    return this.myId == 1;
  }

  private async waitForRevealEpochEnd() {
    const revealPeriodDurationMs = this.client.epochs.revealDurationSec * 1000;
    await sleepFor(revealPeriodDurationMs + 1);
  }
}
