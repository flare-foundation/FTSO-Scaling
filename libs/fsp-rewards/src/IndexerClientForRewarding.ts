import { EntityManager } from "typeorm";
import {
  BlockAssuranceResult,
  FinalizationData,
  IndexerClient,
  IndexerResponse,
} from "../../ftso-core/src/IndexerClient";
import { ILogger } from "../../ftso-core/src/utils/ILogger";
import { EPOCH_SETTINGS } from "../../ftso-core/src/constants";
import { FastUpdateFeeds } from "../../contracts/src/events/FastUpdateFeeds";
import { FastUpdateFeedsSubmitted } from "../../contracts/src/events/FastUpdateFeedsSubmitted";
import { IncentiveOffered } from "../../contracts/src/events/IncentiveOffered";
import { FUInflationRewardsOffered } from "../../contracts/src/events/FUInflationRewardsOffered";
import { FDCInflationRewardsOffered } from "../../contracts/src/events/FDCInflationRewardsOffered";
import { AttestationRequest } from "../../contracts/src/events/AttestationRequest";
import { TeeInstructionsSent } from "../../contracts/src/events/TeeInstructionsSent";
import { Fdc2AttestationRequested } from "../../contracts/src/events/Fdc2AttestationRequested";
import { fccEventVotingRound } from "./reward-calculation/fcc/fcc-event-placement";

import { TLPEvents } from "../../ftso-core/src/orm/entities";
import { COSTON_FAST_UPDATER_SWITCH_VOTING_ROUND_ID, SONGBIRD_FAST_UPDATER_SWITCH_VOTING_ROUND_ID } from "./constants";
import { CONTRACTS, networks } from "../../contracts/src/constants";
import { ContractDefinitions, ContractMethodNames } from "../../contracts/src/definitions";
export class IndexerClientForRewarding extends IndexerClient {
  constructor(
    protected readonly entityManager: EntityManager,
    public readonly requiredHistoryTimeSec: number,
    protected readonly logger: ILogger
  ) {
    super(entityManager, requiredHistoryTimeSec, logger);
  }

  /**
   * Finalization transactions in the timestamp range, from every Relay they may be on. Returned only if the
   * indexer covers the range, and not necessarily in chain order.
   */
  public async getFinalizationDataInRange(
    startTime: number,
    endTime: number
  ): Promise<IndexerResponse<FinalizationData[]>> {
    const ensureRange = await this.ensureBlockRange(startTime, endTime);
    if (ensureRange !== BlockAssuranceResult.OK) {
      return {
        status: ensureRange,
        data: [],
      };
    }

    const finalizations: FinalizationData[] = [];
    for (const relay of this.relays()) {
      const transactionsResults = await this.queryTransactions(relay, ContractMethodNames.relay, startTime, endTime);
      for (const tx of transactionsResults) {
        const timestamp = tx.timestamp;
        const votingEpochId = EPOCH_SETTINGS().votingEpochForTimeSec(timestamp);
        finalizations.push({
          submitAddress: "0x" + tx.from_address,
          relativeTimestamp: timestamp - EPOCH_SETTINGS().votingEpochStartSec(votingEpochId),
          votingEpochIdFromTimestamp: votingEpochId,
          transactionIndex: tx.transaction_index,
          timestamp,
          blockNumber: tx.block_number,
          messages: tx.input,
          successfulOnChain: tx.status > 0,
          relayAddress: relay.address,
        } as FinalizationData);
      }
    }

    return {
      status: ensureRange,
      data: finalizations,
    };
  }

  /**
   * Extract FastUpdateFeeds events from the indexer that match the range of voting rounds.
   */
  public async getFastUpdateFeedsEvents(
    startVotingRoundId: number,
    endVotingRoundId: number
  ): Promise<IndexerResponse<FastUpdateFeeds[]>> {
    const startTime = EPOCH_SETTINGS().votingEpochStartSec(startVotingRoundId + 1);
    // take one voting epoch more for buffer
    const endTime = EPOCH_SETTINGS().votingEpochStartSec(endVotingRoundId + 2);
    const eventName = FastUpdateFeeds.eventName;
    const status = await this.ensureBlockRange(startTime, endTime);
    if (status !== BlockAssuranceResult.OK) {
      return { status };
    }

    const result: TLPEvents[] = [];

    // TEMP CHANGE for upgrading Relay contract, can be removed in December 2024
    const network = process.env.NETWORK as networks;

    const oldSongbirdFastUpdater = "0x70e8870ef234EcD665F96Da4c669dc12c1e1c116";
    if (
      network === "songbird" &&
      CONTRACTS.FastUpdater.address !== oldSongbirdFastUpdater &&
      startVotingRoundId <= SONGBIRD_FAST_UPDATER_SWITCH_VOTING_ROUND_ID
    ) {
      this.logger.log(`Querying old FastUpdater address for Songbird: ${oldSongbirdFastUpdater}`);
      result.push(
        ...(await this.queryEvents(
          { ...CONTRACTS.FastUpdater, address: oldSongbirdFastUpdater },
          eventName,
          startTime,
          endTime
        ))
      );
    }

    const oldCostonFastUpdater = "0x9B931f5d3e24fc8C9064DB35bDc8FB4bE0E862f9";
    if (
      network === "coston" &&
      CONTRACTS.FastUpdater.address !== oldCostonFastUpdater &&
      startVotingRoundId <= COSTON_FAST_UPDATER_SWITCH_VOTING_ROUND_ID
    ) {
      this.logger.log(`Querying old FastUpdater address for Coston: ${oldCostonFastUpdater}`);
      result.push(
        ...(await this.queryEvents(
          { ...CONTRACTS.FastUpdater, address: oldCostonFastUpdater },
          eventName,
          startTime,
          endTime
        ))
      );
    }

    // END TEMP CHANGE

    result.push(...(await this.queryEvents(CONTRACTS.FastUpdater, eventName, startTime, endTime)));
    IndexerClient.sortEvents(result);

    const data: FastUpdateFeeds[] = [];
    let processed = -1;
    // The batch is fully devoid of FastUpdateFeeds events
    if (result.length === 0) {
      this.logger.error(`Missing FastUpdateFeeds events: ${startVotingRoundId} to ${endVotingRoundId}`);

      for (let i = startVotingRoundId; i <= endVotingRoundId; i++) {
        // eslint-disable-next-line
        data.push("MISSING_FAST_UPDATE_FEEDS" as any);
      }
      processed = endVotingRoundId;
    }
    for (let i = 0; i < result.length; i++) {
      const event = FastUpdateFeeds.fromRawEvent(result[i]);
      // queryEvents returns blockchain chronologically ordered events
      if (event.votingRoundId >= startVotingRoundId && event.votingRoundId <= endVotingRoundId) {
        if ((processed === -1 && event.votingRoundId === startVotingRoundId) || event.votingRoundId === processed + 1) {
          data.push(event);
          processed = event.votingRoundId;
        } else {
          // Gaps in events
          let start = -1;
          // no first voting round event
          if (processed === -1) {
            processed = startVotingRoundId - 1;
          }
          // remember the start position for logging
          if (processed + 1 < event.votingRoundId) {
            start = processed + 1;
          }
          // jump over missing events
          while (processed + 1 < event.votingRoundId) {
            // eslint-disable-next-line
            data.push("MISSING_FAST_UPDATE_FEEDS" as any);
            processed++;
          }
          // one error log for the whole gap
          if (start !== -1) {
            this.logger.error(`Missing FastUpdateFeeds events (gap): ${start} to ${event.votingRoundId - 1}`);
          }
          data.push(event);
          processed++;
          continue;
        }
      }
    }
    if (processed !== endVotingRoundId) {
      // process the gap at the end of the range
      this.logger.error(`Missing FastUpdateFeeds events (end gap): ${processed + 1} to ${endVotingRoundId}`);
      while (processed !== endVotingRoundId) {
        // eslint-disable-next-line
        data.push("MISSING_FAST_UPDATE_FEEDS" as any);
        processed++;
      }
    }
    return {
      status,
      data,
    };
  }

  /**
   * Extract FastUpdateFeedsSubmitted events from the indexer that match the range of voting rounds.
   */
  public async getFastUpdateFeedsSubmittedEvents(
    startVotingRoundId: number,
    endVotingRoundId: number
  ): Promise<IndexerResponse<FastUpdateFeedsSubmitted[][]>> {
    const startTime = EPOCH_SETTINGS().votingEpochStartSec(startVotingRoundId);
    // Adding extra round as buffer to ensure all events are captured, as there are cases where FastUpdateFeedsSubmitted events are emitted slightly outside the voting epoch.
    // This is safe to do as we only process events containing votingRoundId within the range.
    const endTime = EPOCH_SETTINGS().votingEpochStartSec(endVotingRoundId + 2);
    const eventName = FastUpdateFeedsSubmitted.eventName;
    const status = await this.ensureBlockRange(startTime, endTime);
    if (status !== BlockAssuranceResult.OK) {
      return { status };
    }

    const result: TLPEvents[] = [];

    // TEMP CHANGE for upgrading Relay contract, can be removed in December 2024
    const network = process.env.NETWORK as networks;

    const oldSongbirdFastUpdater = "0x70e8870ef234EcD665F96Da4c669dc12c1e1c116";
    if (
      network === "songbird" &&
      CONTRACTS.FastUpdater.address !== oldSongbirdFastUpdater &&
      startVotingRoundId <= SONGBIRD_FAST_UPDATER_SWITCH_VOTING_ROUND_ID
    ) {
      this.logger.log(`Querying old FastUpdater address for Songbird: ${oldSongbirdFastUpdater}`);
      result.push(
        ...(await this.queryEvents(
          { ...CONTRACTS.FastUpdater, address: oldSongbirdFastUpdater },
          eventName,
          startTime,
          endTime
        ))
      );
    }

    const oldCostonFastUpdater = "0x9B931f5d3e24fc8C9064DB35bDc8FB4bE0E862f9";
    if (
      network === "coston" &&
      CONTRACTS.FastUpdater.address !== oldCostonFastUpdater &&
      startVotingRoundId <= COSTON_FAST_UPDATER_SWITCH_VOTING_ROUND_ID
    ) {
      this.logger.log(`Querying old FastUpdater address for Coston: ${oldCostonFastUpdater}`);
      result.push(
        ...(await this.queryEvents(
          { ...CONTRACTS.FastUpdater, address: oldCostonFastUpdater },
          eventName,
          startTime,
          endTime
        ))
      );
    }

    // END TEMP CHANGE

    result.push(...(await this.queryEvents(CONTRACTS.FastUpdater, eventName, startTime, endTime)));
    IndexerClient.sortEvents(result);
    const votingRoundIdToEvents = new Map<number, FastUpdateFeedsSubmitted[]>();

    for (let i = 0; i < result.length; i++) {
      const event = FastUpdateFeedsSubmitted.fromRawEvent(result[i]);
      if (event.votingRoundId >= startVotingRoundId && event.votingRoundId <= endVotingRoundId) {
        if (!votingRoundIdToEvents.has(event.votingRoundId)) {
          votingRoundIdToEvents.set(event.votingRoundId, []);
        }
        votingRoundIdToEvents.get(event.votingRoundId).push(event);
      }
    }
    const data: FastUpdateFeedsSubmitted[][] = [];
    for (let i = startVotingRoundId; i <= endVotingRoundId; i++) {
      const eventsForEpochId = votingRoundIdToEvents.get(i);
      if (eventsForEpochId === undefined) {
        this.logger.warn(`No FastUpdateFeedsSubmitted events for voting round ${i}`);
      }
      data.push(eventsForEpochId || []);
    }
    return {
      status,
      data,
    };
  }

  /**
   * Extract IncentiveOffered events from the indexer that match the range of voting rounds.
   */
  public async getIncentiveOfferedEvents(rewardEpochId: number): Promise<IndexerResponse<IncentiveOffered[]>> {
    // `FastUpdateIncentiveManager.offerIncentive` credits `getCurrentRewardEpochId()` with no compensation for the
    // epoch boundary, exactly as the FCC contracts do and unlike `FdcHub`, which rolls forward near the epoch end.
    // So an incentive is attributed the same way FCC fees are: collected over the epoch's funding window, whose
    // inclusive edges guarantee a superset, then narrowed by the reward epoch id the event carries itself.
    //
    // Before this, incentives were collected over the epoch's voting round schedule and never filtered, so one
    // offered across a boundary funded one epoch on chain while being counted towards another's fast updates pool.
    const window = await this.getRewardEpochFundingWindow(rewardEpochId);
    const eventName = IncentiveOffered.eventName;
    const status = await this.ensureBlockRange(window.startTimeSec, window.endTimeSec);
    if (status !== BlockAssuranceResult.OK) {
      return { status };
    }

    const result = await this.queryEvents(
      CONTRACTS.FastUpdateIncentiveManager,
      eventName,
      window.startTimeSec,
      window.endTimeSec
    );
    const data = result
      .map((event) => IncentiveOffered.fromRawEvent(event))
      .filter((event) => event.rewardEpochId === rewardEpochId);
    return {
      status,
      data,
    };
  }

  /**
   * Extract FUInflationRewardsOffered events from the indexer that match the range of voting rounds.
   */
  public async getFUInflationRewardsOfferedEvents(
    startVotingRoundId: number,
    endVotingRoundId: number
  ): Promise<IndexerResponse<FUInflationRewardsOffered[]>> {
    const startTime = EPOCH_SETTINGS().votingEpochStartSec(startVotingRoundId);
    // strictly containing in the range
    const endTime = EPOCH_SETTINGS().votingEpochStartSec(endVotingRoundId + 1) - 1;
    const eventName = FUInflationRewardsOffered.eventName;
    const status = await this.ensureFspEventRange(startTime, endTime);
    const result = await this.queryEvents(CONTRACTS.FastUpdateIncentiveManager, eventName, startTime, endTime);
    if (status !== BlockAssuranceResult.OK) {
      return { status };
    }
    const data = result.map((event) => FUInflationRewardsOffered.fromRawEvent(event));
    return {
      status,
      data,
    };
  }

  /**
   * Extract AttestationRequest events from the indexer that match the range of voting rounds.
   */
  public async getAttestationRequestEvents(
    startVotingRoundId: number,
    endVotingRoundId: number
  ): Promise<IndexerResponse<AttestationRequest[][]>> {
    const startTime = EPOCH_SETTINGS().votingEpochStartSec(startVotingRoundId);
    // strictly containing in the range
    const endTime = EPOCH_SETTINGS().votingEpochStartSec(endVotingRoundId + 1) - 1;
    const eventName = AttestationRequest.eventName;
    const status = await this.ensureBlockRange(startTime, endTime);
    if (status !== BlockAssuranceResult.OK) {
      return { status };
    }
    const result = await this.queryEvents(CONTRACTS.FdcHub, eventName, startTime, endTime);

    const allAttestationRequests = result.map((event) => AttestationRequest.fromRawEvent(event));
    const data: AttestationRequest[][] = [];
    let i = 0;
    for (let votingRoundId = startVotingRoundId; votingRoundId <= endVotingRoundId; votingRoundId++) {
      const attestationRequestsInVotingRound: AttestationRequest[] = [];
      const votingEpochEndTime = EPOCH_SETTINGS().votingEpochStartSec(votingRoundId + 1) - 1;
      while (i < allAttestationRequests.length && allAttestationRequests[i].timestamp <= votingEpochEndTime) {
        attestationRequestsInVotingRound.push(allAttestationRequests[i]);
        i++;
      }
      data.push(attestationRequestsInVotingRound);
    }
    return {
      status,
      data,
    };
  }

  /**
   * The window during which fees are credited to a reward epoch on chain.
   *
   * `RewardManager.receiveRewards` is called with `getCurrentRewardEpochId()`, which flips exactly when
   * `RewardEpochStarted` is emitted. That moment lags the voting round schedule by an unbounded amount, so the
   * schedule cannot be used to decide which epoch a fee funded. The window is bounded by the two `RewardEpochStarted`
   * events instead, and **both edges are inclusive**: timestamps have one second granularity and are shared by every
   * event in a block, so an inclusive window is a superset that cannot miss an event. Callers then narrow it exactly
   * by the reward epoch id the events carry themselves.
   *
   * Throws if the next epoch has not started, since its start is what closes the window; the funding of a reward
   * epoch is not final until then.
   */
  public async getRewardEpochFundingWindow(
    rewardEpochId: number
  ): Promise<{ startTimeSec: number; endTimeSec: number }> {
    const start = await this.getStartOfRewardEpochEvent(rewardEpochId);
    const next = await this.getStartOfRewardEpochEvent(rewardEpochId + 1);
    if (start.data === undefined) {
      throw new Error(`No RewardEpochStarted event for reward epoch ${rewardEpochId}, cannot attribute fees to it`);
    }
    if (next.data === undefined) {
      throw new Error(
        `No RewardEpochStarted event for reward epoch ${rewardEpochId + 1}: reward epoch ${rewardEpochId} is not ` +
          `closed yet, so the fees credited to it are not final`
      );
    }
    return { startTimeSec: start.data.timestamp, endTimeSec: next.data.timestamp };
  }

  /**
   * Extracts FCC fee events over a reward epoch's funding window, bucketed per voting round.
   *
   * The window overshoots the epoch's voting rounds at both ends, so an event is bucketed into the voting round of
   * its timestamp **clamped** into the epoch's range: a fee paid after the last scheduled round but still credited to
   * this epoch belongs to its final round. Filtering to the events this epoch actually funded is the caller's job,
   * using the reward epoch id the events carry.
   */
  private async getFccEventsInFundingWindow<T extends { timestamp: number }>(
    contract: ContractDefinitions,
    eventName: string,
    fromRawEvent: (event: TLPEvents) => T,
    window: { startTimeSec: number; endTimeSec: number },
    epoch: { firstVotingRoundId: number; lastVotingRoundId: number },
    batchFirstVotingRoundId: number,
    batchLastVotingRoundId: number
  ): Promise<IndexerResponse<T[][]>> {
    const status = await this.ensureBlockRange(window.startTimeSec, window.endTimeSec);
    if (status !== BlockAssuranceResult.OK) {
      return { status };
    }
    const result = await this.queryEvents(contract, eventName, window.startTimeSec, window.endTimeSec);
    const data: T[][] = [];
    for (let votingRoundId = batchFirstVotingRoundId; votingRoundId <= batchLastVotingRoundId; votingRoundId++) {
      data.push([]);
    }
    for (const raw of result) {
      const event = fromRawEvent(raw);
      const votingRoundId = fccEventVotingRound(
        event.timestamp,
        epoch.firstVotingRoundId,
        epoch.lastVotingRoundId,
        batchFirstVotingRoundId,
        batchLastVotingRoundId
      );
      if (votingRoundId === undefined) {
        continue;
      }
      data[votingRoundId - batchFirstVotingRoundId].push(event);
    }
    return {
      status,
      data,
    };
  }

  /**
   * Extract TeeInstructionsSent events (FlareTeeManager) over a reward epoch's funding window.
   */
  public async getTeeInstructionsSentEvents(
    window: { startTimeSec: number; endTimeSec: number },
    epoch: { firstVotingRoundId: number; lastVotingRoundId: number },
    batchFirstVotingRoundId: number,
    batchLastVotingRoundId: number
  ): Promise<IndexerResponse<TeeInstructionsSent[][]>> {
    return this.getFccEventsInFundingWindow(
      CONTRACTS.FlareTeeManager,
      TeeInstructionsSent.eventName,
      (event) => TeeInstructionsSent.fromRawEvent(event),
      window,
      epoch,
      batchFirstVotingRoundId,
      batchLastVotingRoundId
    );
  }

  /**
   * Extract AttestationRequested events (Fdc2Hub) over a reward epoch's funding window.
   * Note: this is the FDC2 event, distinct from the legacy FdcHub AttestationRequest event handled above.
   */
  public async getFdc2AttestationRequestedEvents(
    window: { startTimeSec: number; endTimeSec: number },
    epoch: { firstVotingRoundId: number; lastVotingRoundId: number },
    batchFirstVotingRoundId: number,
    batchLastVotingRoundId: number
  ): Promise<IndexerResponse<Fdc2AttestationRequested[][]>> {
    return this.getFccEventsInFundingWindow(
      CONTRACTS.Fdc2Hub,
      Fdc2AttestationRequested.eventName,
      (event) => Fdc2AttestationRequested.fromRawEvent(event),
      window,
      epoch,
      batchFirstVotingRoundId,
      batchLastVotingRoundId
    );
  }

  /**
   * Extract FDCInflationRewardsOffered events from the indexer that match the range of voting rounds.
   */
  public async getFDCInflationRewardsOfferedEvents(
    startVotingRoundId: number,
    endVotingRoundId: number
  ): Promise<IndexerResponse<FDCInflationRewardsOffered[]>> {
    const startTime = EPOCH_SETTINGS().votingEpochStartSec(startVotingRoundId);
    // strictly containing in the range
    const endTime = EPOCH_SETTINGS().votingEpochStartSec(endVotingRoundId + 1) - 1;
    const eventName = FDCInflationRewardsOffered.eventName;
    const status = await this.ensureFspEventRange(startTime, endTime);
    if (status !== BlockAssuranceResult.OK) {
      return { status };
    }
    const result = await this.queryEvents(CONTRACTS.FdcHub, eventName, startTime, endTime);
    const data = result.map((event) => FDCInflationRewardsOffered.fromRawEvent(event));
    return {
      status,
      data,
    };
  }
}
