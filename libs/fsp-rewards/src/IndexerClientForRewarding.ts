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

import { TLPEvents, TLPTransaction } from "../../ftso-core/src/orm/entities";
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
   * Queries indexer database for all finalization transactions on the Relay contract in a given timestamp range.
   * It returns the result if the indexer database ensures the data availability in the given timestamp range.
   * The data may not be in order as it appears on blockchain.
   */
  public async getFinalizationDataInRange(
    startTime: number,
    endTime: number
  ): Promise<IndexerResponse<FinalizationData[]>> {
    const ensureRange = await this.ensureEventRange(startTime, endTime);
    if (ensureRange !== BlockAssuranceResult.OK) {
      return {
        status: ensureRange,
        data: [],
      };
    }
    // TEMP CHANGE
    let oldTransactionsResults: TLPTransaction[] = [];
    let secondOldTransactionsResults: TLPTransaction[] = [];
    let oldRelay: ContractDefinitions | undefined;
    let secondOldRelay: ContractDefinitions | undefined;
    const network = process.env.NETWORK as networks;

    // Do this for every network with change
    const oldCostonRelayAddress = "0x32D46A1260BB2D8C9d5Ab1C9bBd7FF7D7CfaabCC";
    if (network === "coston" && CONTRACTS.Relay.address !== oldCostonRelayAddress) {
      oldRelay = {
        ...CONTRACTS.Relay,
        address: oldCostonRelayAddress,
      };
    }

    const secondOldCostonRelayAddress = "0xA300E71257547e645CD7241987D3B75f2012E0E3";
    if (network === "coston" && CONTRACTS.Relay.address !== secondOldCostonRelayAddress) {
      secondOldRelay = {
        ...CONTRACTS.Relay,
        address: secondOldCostonRelayAddress,
      };
    }

    const oldCoston2RelayAddress = "0x4087D4B5E009Af9FF41db910205439F82C3dc63c";
    if (network === "coston2" && CONTRACTS.Relay.address !== oldCoston2RelayAddress) {
      oldRelay = {
        ...CONTRACTS.Relay,
        address: oldCoston2RelayAddress,
      };
    }

    const oldSongbirdRelayAddress = "0xbA35e39D01A3f5710d1e43FC61dbb738B68641c4";
    if (network === "songbird" && CONTRACTS.Relay.address !== oldSongbirdRelayAddress) {
      oldRelay = {
        ...CONTRACTS.Relay,
        address: oldSongbirdRelayAddress,
      };
    }

    const secondOldSongbirdRelayAddress = "0x0D462d2Fec11554D64F52D7c5A5C269d748037aD";
    if (network === "songbird" && CONTRACTS.Relay.address !== secondOldSongbirdRelayAddress) {
      secondOldRelay = {
        ...CONTRACTS.Relay,
        address: secondOldSongbirdRelayAddress,
      };
    }

    const oldFlareRelayAddress = "0xea077600E3065F4FAd7161a6D0977741f2618eec";
    if (network === "flare" && CONTRACTS.Relay.address !== oldFlareRelayAddress) {
      oldRelay = {
        ...CONTRACTS.Relay,
        address: oldFlareRelayAddress,
      };
    }

    if (oldRelay !== undefined) {
      oldTransactionsResults = await this.queryTransactions(oldRelay, ContractMethodNames.relay, startTime, endTime);
    }

    if (secondOldRelay !== undefined) {
      secondOldTransactionsResults = await this.queryTransactions(
        secondOldRelay,
        ContractMethodNames.relay,
        startTime,
        endTime
      );
    }

    // END TEMP CHANGE
    const newTransactionsResults = await this.queryTransactions(
      CONTRACTS.Relay,
      ContractMethodNames.relay,
      startTime,
      endTime
    );

    interface Pair {
      address: string | undefined;
      transactionsResults: TLPTransaction[];
    }
    const jointTransactionResults: Pair[] = [
      {
        address: oldRelay?.address,
        transactionsResults: oldTransactionsResults,
      },
      {
        address: secondOldRelay?.address,
        transactionsResults: secondOldTransactionsResults,
      },
      {
        address: CONTRACTS.Relay.address,
        transactionsResults: newTransactionsResults,
      },
    ];

    const finalizations: FinalizationData[] = [];
    for (const txListPair of jointTransactionResults) {
      const { address, transactionsResults } = txListPair;
      const isOldRelay =
        (oldRelay !== undefined && address === oldRelay.address) ||
        (secondOldRelay !== undefined && address === secondOldRelay.address);
      const tmpFinalizations: FinalizationData[] = transactionsResults.map((tx) => {
        const timestamp = tx.timestamp;
        const votingEpochId = EPOCH_SETTINGS().votingEpochForTimeSec(timestamp);
        return {
          submitAddress: "0x" + tx.from_address,
          relativeTimestamp: timestamp - EPOCH_SETTINGS().votingEpochStartSec(votingEpochId),
          votingEpochIdFromTimestamp: votingEpochId,
          transactionIndex: tx.transaction_index,
          timestamp,
          blockNumber: tx.block_number,
          messages: tx.input,
          successfulOnChain: tx.status > 0,
          isOldRelay,
        } as FinalizationData;
      });
      finalizations.push(...tmpFinalizations);
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
    const status = await this.ensureEventRange(startTime, endTime);
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
    const status = await this.ensureEventRange(startTime, endTime);
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
  public async getIncentiveOfferedEvents(
    startVotingRoundId: number,
    endVotingRoundId: number
  ): Promise<IndexerResponse<IncentiveOffered[]>> {
    const startTime = EPOCH_SETTINGS().votingEpochStartSec(startVotingRoundId);
    // strictly containing in the range
    const endTime = EPOCH_SETTINGS().votingEpochStartSec(endVotingRoundId + 1) - 1;
    const eventName = IncentiveOffered.eventName;
    const status = await this.ensureEventRange(startTime, endTime);
    if (status !== BlockAssuranceResult.OK) {
      return { status };
    }

    const result = await this.queryEvents(CONTRACTS.FastUpdateIncentiveManager, eventName, startTime, endTime);
    const data = result.map((event) => IncentiveOffered.fromRawEvent(event));
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
    const status = await this.ensureEventRange(startTime, endTime);
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
