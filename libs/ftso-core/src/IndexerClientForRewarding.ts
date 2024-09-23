import { EntityManager } from "typeorm";
import { BlockAssuranceResult, IndexerClient, IndexerResponse } from "./IndexerClient";
import { ILogger } from "./utils/ILogger";
import { CONTRACTS, EPOCH_SETTINGS } from "./configs/networks";
import { FastUpdateFeeds } from "./events/FastUpdateFeeds";
import { FastUpdateFeedsSubmitted } from "./events/FastUpdateFeedsSubmitted";
import { IncentiveOffered } from "./events/IncentiveOffered";
import { FUInflationRewardsOffered } from "./events/FUInflationRewardsOffered";
import { FDCInflationRewardsOffered } from "./events/FDCInflationRewardsOffered";
import { AttestationRequest } from "./events/AttestationRequest";

export class IndexerClientForRewarding extends IndexerClient {
  constructor(
    protected readonly entityManager: EntityManager,
    public readonly requiredHistoryTimeSec: number,
    protected readonly logger: ILogger
  ) {
    super(entityManager, requiredHistoryTimeSec, logger);
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
    const status = await this.ensureEventRange(startTime, endTime);
    const result = await this.queryEvents(CONTRACTS.FastUpdater, eventName, startTime, endTime);

    const data: FastUpdateFeeds[] = [];
    if (status !== BlockAssuranceResult.OK) {
      return { status };
    }
    let processed = -1;
    for (let i = 0; i < result.length; i++) {
      const event = FastUpdateFeeds.fromRawEvent(result[i]);
      // queryEvents returns blockchain chronologically ordered events
      if (event.votingRoundId >= startVotingRoundId && event.votingRoundId <= endVotingRoundId) {
        if ((processed === -1 && event.votingRoundId === startVotingRoundId) || event.votingRoundId === processed + 1) {
          data.push(event);
          processed = event.votingRoundId;
        } else {
          throw new Error(
            `FastUpdateFeeds events are not continuous from ${startVotingRoundId} to ${endVotingRoundId}: expected ${
              processed + 1
            }, got ${event.votingRoundId}`
          );
        }
      }
    }
    if (processed !== endVotingRoundId) {
      throw new Error(
        `Cannot get all FastUpdateFeeds events from ${startVotingRoundId} to ${endVotingRoundId}: last processed ${processed}`
      );
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
    const endTime = EPOCH_SETTINGS().votingEpochStartSec(endVotingRoundId + 1);
    const eventName = FastUpdateFeedsSubmitted.eventName;
    const status = await this.ensureEventRange(startTime, endTime);
    const result = await this.queryEvents(CONTRACTS.FastUpdater, eventName, startTime, endTime);
    if (status !== BlockAssuranceResult.OK) {
      return { status };
    }
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
  public async getIncentiveOfferedEvents(
    startVotingRoundId: number,
    endVotingRoundId: number
  ): Promise<IndexerResponse<IncentiveOffered[]>> {
    const startTime = EPOCH_SETTINGS().votingEpochStartSec(startVotingRoundId);
    // strictly containing in the range
    const endTime = EPOCH_SETTINGS().votingEpochStartSec(endVotingRoundId + 1) - 1;
    const eventName = IncentiveOffered.eventName;
    const status = await this.ensureEventRange(startTime, endTime);
    const result = await this.queryEvents(CONTRACTS.FastUpdateIncentiveManager, eventName, startTime, endTime);
    if (status !== BlockAssuranceResult.OK) {
      return { status };
    }

    const data = result.map(event => IncentiveOffered.fromRawEvent(event));
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
    const status = await this.ensureEventRange(startTime, endTime);
    const result = await this.queryEvents(CONTRACTS.FastUpdateIncentiveManager, eventName, startTime, endTime);
    if (status !== BlockAssuranceResult.OK) {
      return { status };
    }
    const data = result.map(event => FUInflationRewardsOffered.fromRawEvent(event));
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
  ): Promise<IndexerResponse<AttestationRequest[]>> {
    const startTime = EPOCH_SETTINGS().votingEpochStartSec(startVotingRoundId);
    // strictly containing in the range
    const endTime = EPOCH_SETTINGS().votingEpochStartSec(endVotingRoundId + 1) - 1;
    const eventName = AttestationRequest.eventName;
    const status = await this.ensureEventRange(startTime, endTime);
    const result = await this.queryEvents(CONTRACTS.FdcHub, eventName, startTime, endTime);
    if (status !== BlockAssuranceResult.OK) {
      return { status };
    }

    const data = result.map(event => AttestationRequest.fromRawEvent(event));
    return {
      status,
      data,
    };
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
    const status = await this.ensureEventRange(startTime, endTime);
    const result = await this.queryEvents(CONTRACTS.FdcHub, eventName, startTime, endTime);
    if (status !== BlockAssuranceResult.OK) {
      return { status };
    }
    const data = result.map(event => FDCInflationRewardsOffered.fromRawEvent(event));
    return {
      status,
      data,
    };
  }

}
