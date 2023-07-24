import { FTSOClient } from "./FTSOClient";
import { sleepFor } from "./time-utils";

export class DataProvider {
  constructor(private client: FTSOClient, private myId: number) {}

  /** Used for checking if we need to send reveals in the current price epoch. */
  private hasCommits: boolean = false;
  /** Tracks reward epochs the data provider is registered as a voter for. */
  private registeredRewardEpochs = new Set<number>();

  async run() {
    const currentBlock = await this.client.provider.getBlockNumber()
    this.client.initialize(currentBlock);
    this.processBlocks();
    this.schedulePriceEpochActions();
  }

  private async processBlocks() {
    while (true) {
      await this.client.processNewBlocks();
      await sleepFor(500);
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

    console.log(`[On price epoch] ${currentEpochId}, reward epoch ${currentRewardEpochId}.`);

    const previousRewardEpochId = currentRewardEpochId - 1;
    const nextRewardEpochId = currentRewardEpochId + 1;

    if (this.isRegisteredForRewardEpoch(currentRewardEpochId)) {
      await this.runVotingProcotol(currentEpochId);

      if (this.isRegisteredForRewardEpoch(previousRewardEpochId) && this.isFirstPriceEpochInRewardEpoch(currentEpochId)) {
        console.log(`Claiming rewards for last reward epoch ${previousRewardEpochId}`);
        await this.client.claimReward(previousRewardEpochId);
      }
    }

    if (!this.isRegisteredForRewardEpoch(nextRewardEpochId) && this.client.rewardEpochOffers.has(nextRewardEpochId)) {
      await this.registerForRewardEpoch(nextRewardEpochId);
    }
  }

  private async runVotingProcotol(currentEpochId: number) {
    console.log("[[[[[[Start voting protocol]]]]]");

    console.log(`[Voting] On commit for current ${currentEpochId}`);
    this.client.preparePriceFeedsForPriceEpoch(currentEpochId);
    await this.client.onCommit(currentEpochId);

    if (this.hasCommits) {
      const previousEpochId = currentEpochId - 1;
      console.log(`[Voting] On reveal for previous ${previousEpochId}`);
      await this.client.onReveal(previousEpochId);
      await this.waitForRevealEpochEnd();
      console.log(`[Voting] Calculate results and on sign prev ${previousEpochId}`);
      await this.client.onSign(previousEpochId);
      await sleepFor(2000); // Wait for others' signatures.
      if (this.shouldFinalize()) {
        console.log(`[Voting] Send signatures for prev ${previousEpochId}`);
        await this.client.onSendSignaturesForMyMerkleRoot(previousEpochId);
      }
    }

    this.hasCommits = true;
    console.log("[[[[[[End voting protocol]]]]]");
  }

  private async registerForRewardEpoch(nextRewardEpochId: number) {
    console.log(`Registering for reward epoch ${nextRewardEpochId}`);

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
