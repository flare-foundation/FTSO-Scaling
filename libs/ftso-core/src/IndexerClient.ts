import { EntityManager } from "typeorm";
import { TLPEvents, TLPState, TLPTransaction } from "./orm/entities";
import { EncodingUtils, decodePayloadMessageCalldata } from "./utils/EncodingUtils";
import { Address, VotingEpochId } from "./voting-types";

import { IPayloadMessage } from "../../fsp-utils/src/PayloadMessage";
import { IRelayMessage } from "../../fsp-utils/src/RelayMessage";
import { CONTRACTS, EPOCH_SETTINGS, FIRST_DATABASE_INDEX_STATE, LAST_DATABASE_INDEX_STATE } from "./configs/networks";
import { ContractDefinitions, ContractMethodNames } from "./configs/contracts";
import {
  FullVoterRegistrationInfo,
  InflationRewardsOffered,
  RandomAcquisitionStarted,
  RewardEpochStarted,
  RewardOffers,
  RewardsOffered,
  SigningPolicyInitialized,
  VotePowerBlockSelected,
  VoterRegistered,
  VoterRegistrationInfo,
} from "./events";

/**
 * Generic object for submission data and finalization data.
 */
export interface GenericSubmissionData<T> {
  submitAddress: Address;
  votingEpochIdFromTimestamp: VotingEpochId; // voting round id in which the message was submitted
  relativeTimestamp: number; // timestamp relative to the start of the voting round
  blockNumber: number;
  timestamp: number;
  transactionIndex: number;
  messages: T;
}

/**
 * Submission data for messages sent to function 'submit1', ..., 'submit3' of contract Submission.
 */
export type SubmissionData = GenericSubmissionData<IPayloadMessage<string>[]>;
/**
 * Unparsed finalization data from finalization calls (relay()) on Relay contract.
 */
export interface FinalizationData extends GenericSubmissionData<string> {
  successfulOnChain: boolean;
}
/**
 * Parsed finalization data from finalization calls (relay()) on Relay contract.
 */
export interface ParsedFinalizationData extends GenericSubmissionData<IRelayMessage> {
  successfulOnChain: boolean;
}

/**
 * Indexer query response wrapper.
 */
export interface IndexerResponse<T> {
  status: BlockAssuranceResult;
  data?: T;
}

/**
 * Prepares hex byte value for querying the indexer database.
 * In the indexer database all hex values are strings without '0x' prefix, lowercase.
 * @param address
 * @returns
 */
export function queryBytesFormat(address: string): string {
  return (address.startsWith("0x") ? address.slice(2) : address).toLowerCase();
}

/**
 * Result of block assurance check.
 */
export enum BlockAssuranceResult {
  /**
   * Block range indexed and we have insurance of having one block with strictly
   * lower timestamp then startTime and one block with strictly greater timestamp than endTime
   */
  OK,
  /**
   * Block range not indexed
   */
  NOT_OK,
  /**
   * There exists a block with timestamp strictly lower than startTime but there is no
   * block with timestamp strictly greater that endTim,e but
   */
  TIMEOUT_OK,
}

/**
 * IndexerClient is a helper class for querying events and transactions from the indexer database.
 * All the queries are based on timestamp ranges.
 * Queries of events are of two forms:
 *   - trying to find a boundary event (e.g. start of reward epoch) in a given expected timestamp range.
 *     Such a query may fail and is repeated until relevant boundary event is found.
 *   - once top and bottom boundaries are obtained, we have insurance that all the events in the range are indexed. Then
 *     a query on events in the timestamp range is performed.
 *
 * Queries of transactions which hold information in calldata are performed based on timestamp ranges.
 * When a query is executed it is checked whether the indexer database has sufficient indexed range.
 * This is ensured if there exists a block with strictly lower timestamp than startTime and
 * a block with strictly greater timestamp than endTime.
 * We allow for an option that a block with index strictly greater than endTime is missing in database. In such case
 * we support queries with timeout according to local time. Such a query returns result if the local time of time of
 * query is greater than endTime + timeout.
 *
 * The lifecycle of events leading to signing policy initialization is as follows.
 * For given rewardEpochId:
 * - Start of reward offers (low boundary event).
 *    - ["FlareSystemManager", undefined, "RewardEpochStarted"], for rewardEpochId - 1.
 * - End of reward offers (high boundary event).
 *    - ["FlareSystemManager", undefined, "RandomAcquisitionStarted"],
 * - Reward offers between the timestamps of the above two events.
 *    - ["FtsoRewardOffersManager", undefined, "InflationRewardsOffered"],
 *    - ["FtsoRewardOffersManager", undefined, "RewardsOffered"],
 * - Start of voter registration (low boundary event).
 *    - ["FlareSystemManager", undefined, "VotePowerBlockSelected"]
 * - End of voter registration and signing policy (high boundary event)
 *    - ["Relay", undefined, "SigningPolicyInitialized"],
 * - All voter registration events and related voter info events,
 *   between the timestamps of the above two events.
 *    - ["VoterRegistry", undefined, "VoterRegistered"],
 *    - ["FlareSystemCalculator", undefined, "VoterRegistrationInfo"],
 * All these events should be available before the first voting round of the rewardEpochId in order for
 * the protocol data provider to function properly.
 */
export class IndexerClient {
  constructor(private readonly entityManager: EntityManager, public readonly requiredHistoryTimeSec: number) {}

  private readonly encoding = EncodingUtils.instance;

  /**
   * Queries indexer database for events on a smart contract in a given timestamp range.
   */
  private async queryEvents(
    smartContract: ContractDefinitions,
    eventName: string,
    startTime: number,
    endTime?: number
  ): Promise<TLPEvents[]> {
    const eventSignature = this.encoding.getEventSignature(smartContract.name, eventName);
    let query = this.entityManager
      .createQueryBuilder(TLPEvents, "event")
      .andWhere("event.timestamp >= :startTime", { startTime })
      .andWhere("event.address = :contractAddress", { contractAddress: queryBytesFormat(smartContract.address) })
      .andWhere("event.topic0 = :signature", { signature: queryBytesFormat(eventSignature) });
    if (endTime) {
      query = query.andWhere("event.timestamp <= :endTime", { endTime });
    }
    return query.orderBy("event.timestamp", "ASC").getMany();
  }

  /**
   * Queries indexer database for transactions on a smart contract based on function signature in a given timestamp range.
   */
  private async queryTransactions(
    smartContract: ContractDefinitions,
    functionName: ContractMethodNames,
    startTime: number,
    endTime?: number
  ): Promise<TLPTransaction[]> {
    const functionSignature = this.encoding.getFunctionSignature(smartContract.name, functionName);
    let query = this.entityManager
      .createQueryBuilder(TLPTransaction, "tx")
      .andWhere("tx.timestamp >= :startTime", { startTime })
      .andWhere("tx.to_address = :contractAddress", { contractAddress: queryBytesFormat(smartContract.address) })
      .andWhere("tx.function_sig = :signature", { signature: queryBytesFormat(functionSignature) });
    if (endTime) {
      query = query.andWhere("tx.timestamp <= :endTime", { endTime });
    }

    return query.orderBy("tx.timestamp", "ASC").getMany();
  }

  /**
   * Checks the indexer database has a block hat has a timestamp strictly smaller than startTime
   * @param startTime timestamp in seconds
   * @returns BlockAssuranceResult status (OK | NOT_OK)
   */
  private async ensureLowerBlock(startTime: number): Promise<BlockAssuranceResult> {
    const queryFirst = this.entityManager
      .createQueryBuilder(TLPState, "state")
      .andWhere("state.name = :name", { name: FIRST_DATABASE_INDEX_STATE });
    const firstState = await queryFirst.getOne();
    if (!firstState) {
      return BlockAssuranceResult.NOT_OK;
    }
    if (firstState.block_timestamp >= startTime) {
      return BlockAssuranceResult.NOT_OK;
    }
    return BlockAssuranceResult.OK;
  }

  /**
   * Checks the indexer database for a given endTime possibly with given timeout.
   * If the database contains a block with timestamp strictly greater than endTime, it returns OK.
   * If  the database does not contain a block with timestamp strictly greater than endTime, and
   * no timeout is given, it returns NOT_OK. But if timeout is given, it returns TIMEOUT_OK if the local time
   * is greater than endTime + timeout.
   */
  private async ensureTopBlock(endTime: number, endTimeout?: number): Promise<BlockAssuranceResult> {
    const queryLast = this.entityManager
      .createQueryBuilder(TLPState, "state")
      .andWhere("state.name = :name", { name: LAST_DATABASE_INDEX_STATE });
    const lastState = await queryLast.getOne();
    if (!lastState) {
      return BlockAssuranceResult.NOT_OK;
    }
    if (lastState.block_timestamp <= endTime) {
      if (endTimeout) {
        const now = Math.round(Date.now() / 1000);
        if (now > endTime + endTimeout) {
          return BlockAssuranceResult.TIMEOUT_OK;
        }
        // TODO: Check also "best effort" by indexer.
        // If indexer got stuck, we should return NOT_OK
      }
      return BlockAssuranceResult.NOT_OK;
    }
    return BlockAssuranceResult.OK;
  }

  /**
   * Checks the indexer database for a given minimal timestamp range, possibly with given timeout.
   */
  private async ensureEventRange(
    startTime: number,
    endTime: number,
    endTimeout?: number
  ): Promise<BlockAssuranceResult> {
    const [bottomState, topState] = await Promise.all([
      this.ensureLowerBlock(startTime),
      this.ensureTopBlock(endTime, endTimeout),
    ]);
    if (bottomState === BlockAssuranceResult.OK) {
      return topState;
    }
    return bottomState;
  }

  /**
   * Extracts RewardEpochStarted for a specific @param rewardEpochId from the indexer database,
   * if the event is already indexed. Otherwise returns undefined.
   * The event is a low boundary event for the start of reward offers for rewardEpochId + 1.
   */
  public async getStartOfRewardEpochEvent(rewardEpochId: number): Promise<IndexerResponse<RewardEpochStarted>> {
    const eventName = RewardEpochStarted.eventName;
    const startTime = EPOCH_SETTINGS().expectedRewardEpochStartTimeSec(rewardEpochId);
    const status = await this.ensureLowerBlock(startTime);
    let data: RewardEpochStarted | undefined;
    if (status === BlockAssuranceResult.OK) {
      const result = await this.queryEvents(CONTRACTS.FlareSystemManager, eventName, startTime);
      const events = result.map(event => RewardEpochStarted.fromRawEvent(event));
      data = events.find(event => event.rewardEpochId === rewardEpochId);
    }
    return {
      status,
      data,
    };
  }

  /**
   * Extracts event RandomAcquisitionStarted for a specific @param rewardEpochId from the indexer database,
   * if the event is already indexed. Otherwise returns undefined.
   * The event is boundary event for the end of reward offers for the rewardEpochId.
   */
  public async getRandomAcquisitionStarted(rewardEpochId: number): Promise<IndexerResponse<RandomAcquisitionStarted>> {
    const eventName = RandomAcquisitionStarted.eventName;
    const startTime = EPOCH_SETTINGS().expectedRewardEpochStartTimeSec(rewardEpochId - 1);
    const status = await this.ensureLowerBlock(startTime);
    let data: RandomAcquisitionStarted | undefined;
    if (status === BlockAssuranceResult.OK) {
      const result = await this.queryEvents(CONTRACTS.FlareSystemManager, eventName, startTime);
      const events = result.map(event => RandomAcquisitionStarted.fromRawEvent(event));
      data = events.find(event => event.rewardEpochId === rewardEpochId);
    }
    return {
      status,
      data,
    };
  }

  /**
   * Assuming that the indexer has indexed all the events in the given timestamp range,
   * it extracts all the reward offers and inflation reward offers in the given timestamp range.
   * Timestamp range are obtained from timestamps of relevant events RewardEpochStarted and RandomAcquisitionStarted.
   * IMPORTANT: If this is not the case the function does not provide any guarantee of sufficient data availability in
   * indexer database.
   */
  public async getRewardOffers(startTime: number, endTime: number): Promise<IndexerResponse<RewardOffers>> {
    const status = await this.ensureEventRange(startTime, endTime);
    if (status !== BlockAssuranceResult.OK) {
      return { status };
    }

    const rewardOffersResults = await this.queryEvents(
      CONTRACTS.FtsoRewardOffersManager,
      RewardsOffered.eventName,
      startTime,
      endTime
    );
    const rewardOffers = rewardOffersResults.map(event => RewardsOffered.fromRawEvent(event));

    const inflationOffersResults = await this.queryEvents(
      CONTRACTS.FtsoRewardOffersManager,
      InflationRewardsOffered.eventName,
      startTime,
      endTime
    );
    const inflationOffers = inflationOffersResults.map(event => InflationRewardsOffered.fromRawEvent(event));

    return {
      status,
      data: {
        rewardOffers,
        inflationOffers,
      },
    };
  }

  /**
   * Extracts VotePowerBlockSelected event for a specific @param rewardEpochId from the indexer database,
   * if the event is already indexed. Otherwise returns undefined.
   * This event is a low boundary event for the start of voter registration for rewardEpochId.
   */
  public async getVotePowerBlockSelectedEvent(rewardEpochId: number): Promise<IndexerResponse<VotePowerBlockSelected>> {
    const eventName = VotePowerBlockSelected.eventName;
    const startTime = EPOCH_SETTINGS().expectedRewardEpochStartTimeSec(rewardEpochId - 1);
    const status = await this.ensureLowerBlock(startTime);
    let data: VotePowerBlockSelected | undefined;
    if (status === BlockAssuranceResult.OK) {
      const result = await this.queryEvents(CONTRACTS.FlareSystemManager, eventName, startTime);
      const events = result.map(event => VotePowerBlockSelected.fromRawEvent(event));
      data = events.find(event => event.rewardEpochId === rewardEpochId);
    }
    return {
      status,
      data,
    };
  }

  /**
   * Returns the all SigningPolicyInitialized events on Relay contract with timestamp greater than @param fromStartTime.
   * Events are sorted by timestamp, hence also by rewardEpochId.
   * The query result is returned even if the indexer database does not contain a block with timestamp strictly lower than fromStartTime.
   */
  public async getLatestSigningPolicyInitializedEvents(
    fromStartTime: number
  ): Promise<IndexerResponse<SigningPolicyInitialized[]>> {
    const eventName = SigningPolicyInitialized.eventName;
    const status = await this.ensureLowerBlock(fromStartTime);
    const result = await this.queryEvents(CONTRACTS.Relay, eventName, fromStartTime);
    const data = result.map(event => SigningPolicyInitialized.fromRawEvent(event));
    return {
      status,
      data,
    };
  }

  /**
   * Assuming that the indexer has indexed all the events in the given timestamp range,
   * it extracts all the 'VoterRegistered' (VoterRegistry contract) and
   * VoterRegistrationInfo (FlareSystemCalculator contract) events in the given timestamp range.
   * Timestamp range are obtained from timestamps of relevant events VotePowerBlockSelectedEvent and SigningPolicyInitialized.
   * The function checks the availability of block range in the indexer database.
   */
  public async getFullVoterRegistrationInfoEvents(
    startTime: number,
    endTime: number
  ): Promise<IndexerResponse<FullVoterRegistrationInfo[]>> {
    const status = await this.ensureEventRange(startTime, endTime);
    if (status !== BlockAssuranceResult.OK) {
      return { status };
    }
    const voterRegisteredResults = await this.queryEvents(
      CONTRACTS.VoterRegistry,
      VoterRegistered.eventName,
      startTime,
      endTime
    );
    const voterRegistered = voterRegisteredResults.map(event => VoterRegistered.fromRawEvent(event));

    const voterRegistrationInfoResults = await this.queryEvents(
      CONTRACTS.FlareSystemCalculator,
      VoterRegistrationInfo.eventName,
      startTime,
      endTime
    );
    const voterRegistrationInfo = voterRegistrationInfoResults.map(event => VoterRegistrationInfo.fromRawEvent(event));

    if (voterRegistered.length !== voterRegistrationInfo.length) {
      throw new Error(
        `VoterRegistered and VoterRegistrationInfo events count mismatch: ${voterRegistered.length} !== ${voterRegistrationInfo.length}`
      );
    }
    voterRegistered.sort((a, b) => {
      if (a.voter < b.voter) {
        return -1;
      }
      if (a.voter > b.voter) {
        return 1;
      }
      return 0;
    });

    voterRegistrationInfo.sort((a, b) => {
      if (a.voter < b.voter) {
        return -1;
      }
      if (a.voter > b.voter) {
        return 1;
      }
      return 0;
    });
    const results: FullVoterRegistrationInfo[] = [];
    for (let i = 0; i < voterRegistered.length; i++) {
      if (voterRegistered[i].voter !== voterRegistrationInfo[i].voter) {
        throw new Error(
          `VoterRegistered and VoterRegistrationInfo events mismatch at index ${i}: ${voterRegistered[i].voter} !== ${voterRegistrationInfo[i].voter}`
        );
      }
      results.push({
        voterRegistered: voterRegistered[i],
        voterRegistrationInfo: voterRegistrationInfo[i],
      });
    }
    return {
      status,
      data: results,
    };
  }

  /**
   * Extracts all the submissions through function @param functionName in a given time range.
   */
  public async getSubmissionDataInRange(
    functionName: ContractMethodNames,
    startTime: number,
    endTime: number,
    endTimeout?: number,
    queryResultsEvenIfRangeCheckFails?: boolean
  ): Promise<IndexerResponse<SubmissionData[]>> {
    const ensureRange = await this.ensureEventRange(startTime, endTime, endTimeout);
    if (!queryResultsEvenIfRangeCheckFails && ensureRange === BlockAssuranceResult.NOT_OK) {
      return {
        status: ensureRange,
        data: [],
      };
    }
    const transactionsResults = await this.queryTransactions(CONTRACTS.Submission, functionName, startTime, endTime);
    const submits: SubmissionData[] = transactionsResults.map(tx => {
      const timestamp = tx.timestamp;
      const votingEpochId = EPOCH_SETTINGS().votingEpochForTimeSec(timestamp);
      const messages = decodePayloadMessageCalldata(tx);
      return {
        submitAddress: "0x" + tx.from_address,
        relativeTimestamp: timestamp - EPOCH_SETTINGS().votingEpochStartSec(votingEpochId),
        votingEpochIdFromTimestamp: votingEpochId,
        transactionIndex: tx.transaction_index,
        timestamp,
        blockNumber: tx.block_number,
        messages,
      };
    });

    return {
      status: ensureRange,
      data: submits,
    };
  }

  /**
   * Queries indexer database for all finalization transactions on the Relay contract in a given timestamp range.
   * It returns the result if the indexer database ensures the data availability in the given timestamp range.
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
    const transactionsResults = await this.queryTransactions(
      CONTRACTS.Relay,
      ContractMethodNames.relay,
      startTime,
      endTime
    );
    const finalizations: FinalizationData[] = transactionsResults.map(tx => {
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
      } as FinalizationData;
    });

    return {
      status: ensureRange,
      data: finalizations,
    };
  }
}
