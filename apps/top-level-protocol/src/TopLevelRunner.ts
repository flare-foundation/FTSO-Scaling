import { BlockIndex } from "../../../libs/ftso-core/src/BlockIndex";
import { IVotingProvider } from "../../../libs/ftso-core/src/IVotingProvider";
import { EpochSettings } from "../../../libs/ftso-core/src/utils/EpochSettings";
import { errorString, asError } from "../../../libs/ftso-core/src/utils/error";
import {
  BareSignature,
  EpochData,
} from "../../../libs/ftso-core/src/voting-types";
import { getLogger } from "../../ftso-calculator/src/utils/logger";
import { TimeoutError, promiseWithTimeout } from "../../ftso-calculator/src/utils/retry";
import { randomDelay, runWithDuration, sleepFor } from "../../ftso-calculator/src/utils/time";
import { Controller, Get, Param } from '@nestjs/common';

// export interface SubProtocol2 {


//   protocolId: number;

//   getCommit(epochId: number): Promise<string>;
//   getReveal(epochId: number): Promise<EpochData | undefined>;
//   getResult(epochId: number): Promise<[string, BareSignature] | undefined>;
// }

export interface SubProtocol {
  protocolId: number;

  getCommit(epochId: number): Promise<string>;
  getReveal(epochId: number): Promise<EpochData | undefined>;
  getResult(epochId: number): Promise<string | undefined>;
  getResultAfterDeadline(epochId: number, deadlineSec: number): Promise<string>;
}



export class TopLevelRunner {
  private readonly logger = getLogger(TopLevelRunner.name);

  constructor(
    private readonly protocols: SubProtocol[] = [],
    private readonly epochs: EpochSettings,
    private readonly votingProvider: IVotingProvider,
    private readonly index: BlockIndex
  ) {}

  /** Tracks reward epochs the data provider is registered as a voter for. */
  private readonly registeredRewardEpochs = new Set<number>();

  async run() {
    this.scheduleVotingEpochActions();
  }

  scheduleVotingEpochActions() {
    const timeSec = this.currentTimeSec();
    const nextEpochStartSec = this.epochs.nextPriceEpochStartSec(timeSec);

    setTimeout(async () => {
      this.scheduleVotingEpochActions();
      try {
        await this.onVotingEpoch(
          nextEpochStartSec + this.epochs.epochDurationSec
        );
      } catch (e) {
        this.logger.error(`Error in epoch, terminating: ${errorString(e)}`);
        process.exit(1);
      }
    }, (nextEpochStartSec - timeSec + 1) * 1000);
  }

  async onVotingEpoch(epochDeadlineSec: number) {
    const currentVotingEpochId = this.epochs.priceEpochIdForTime(
      this.currentTimeSec()
    );
    const currentRewardEpochId =
      this.epochs.rewardEpochIdForPriceEpochId(currentVotingEpochId);
    this.logger.info(
      `[${currentVotingEpochId}] Processing voting epoch, current reward epoch: ${currentRewardEpochId}.`
    );

    await this.runVotingProcotol(currentVotingEpochId, epochDeadlineSec);

    this.logger.info(
      `[${currentVotingEpochId}] Finished processing voting epoch.`
    );
  }

  private async runVotingProcotol(
    currentEpochId: number,
    epochDeadlineSec: number
  ) {
    const commitHash = await this.protocols[0].getCommit(currentEpochId);
    await this.votingProvider.commit(commitHash);

    await sleepFor(2000);
    const previousEpochId = currentEpochId - 1;
    this.logger.info(
      `[${currentEpochId}] Revealing data for previous epoch: ${previousEpochId}.`
    );

    const revealData = await this.protocols[0].getReveal(previousEpochId);
    if (revealData !== undefined) {
      await this.votingProvider.revealBitvote(revealData);

      const revealEnd = epochDeadlineSec - this.epochs.revealDurationSec;

      this.logger.info(
        `[${currentEpochId}] Calculating results for previous epoch ${previousEpochId} and signing.`
      );

      const result = await this.protocols[0].getResultAfterDeadline(
        previousEpochId,
        revealEnd
      );
      await randomDelay(0, 2000);

      const signature = await this.votingProvider.signMessage(result);
      await this.votingProvider.signResult(previousEpochId, result, signature);

      await runWithDuration(
        "FINALIZATION",
        async () => await this.awaitFinalizationOrTimeout(previousEpochId)
      );
      if (this.currentTimeSec() > epochDeadlineSec) {
        this.logger.warn(
          `Finalization happened outside price epoch window: ${this.currentTimeSec()} > ${epochDeadlineSec}`
        );
      }
    }
  }

  private async awaitFinalizationOrTimeout(priceEpochId: number) {
    try {
      await promiseWithTimeout(this.awaitFinalization(priceEpochId), 30_000);
    } catch (e) {
      const error = asError(e);
      if (e instanceof TimeoutError) {
        this.logger.error(
          `[${priceEpochId}] Timed out waiting for finalization.`
        );
        throw error;
      }
    }
  }

  private async awaitFinalization(priceEpochId: number) {
    while (!this.index.getFinalize(priceEpochId)) {
      this.logger.info(
        `Epoch ${priceEpochId} not finalized, keep processing new blocks`
      );
      await sleepFor(500);
    }
    this.logger.info(`Epoch ${priceEpochId} finalized, continue.`);
  }

  private async waitForRevealEpochEnd() {
    const revealPeriodDurationMs = this.epochs.revealDurationSec * 1000;
    await sleepFor(revealPeriodDurationMs + 1);
  }

  private currentTimeSec(): number {
    return Math.floor(Date.now() / 1000);
  }
}
