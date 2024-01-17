import { EntityManager } from "typeorm";
import { TLPEvents, TLPState, TLPTransaction } from "./orm/entities";
import { decodePayloadMessageCalldata, getEventSignature, getFunctionSignature } from "./utils/EncodingUtils";
import {
  Address,
  VotingEpochId
} from "./voting-types";

import { CONTRACTS, ContractDefinitions, EPOCH_SETTINGS, FIRST_DATABASE_INDEX_STATE, LAST_DATABASE_INDEX_STATE } from "./configs/networks";
import { FullVoterRegistrationInfo, InflationRewardsOffered, RandomAcquisitionStarted, RewardEpochStarted, RewardOffers, RewardsOffered, SigningPolicyInitialized, VotePowerBlockSelected, VoterRegistered, VoterRegistrationInfo } from "./events";
import { IPayloadMessage } from "./utils/PayloadMessage";


export interface SubmissionData {
  submitAddress: Address;
  votingEpochId: VotingEpochId; // voting round id in which the message was submitted
  relativeTimestamp: number; // timestamp relative to the start of the voting round
  messages: IPayloadMessage<string>[];
}
export interface SubmitResponse {
  queryResult: BlockAssuranceResult;
  submits: SubmissionData[];
}

function queryBytesFormat(address: string): string {
  return (address.startsWith("0x") ? address.slice(2) : address).toLowerCase();
}

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

  constructor(private readonly entityManager: EntityManager) { }

  /**
   * Queries indexer database for events on a smart contract in a given timestamp range.
   * @param smartContract 
   * @param eventName 
   * @param startTime 
   * @param endTime 
   * @returns 
   */
  private async queryEvents(smartContract: ContractDefinitions, eventName: string, startTime: number, endTime?: number): Promise<TLPEvents[]> {
    const eventSignature = getEventSignature(smartContract.name, eventName);
    let query = this.entityManager
      .createQueryBuilder(TLPEvents, "event")
      .andWhere("event.timestamp >= :startTime", { startTime })
      .andWhere("event.address = :contractAddress", { contractAddress: queryBytesFormat(smartContract.address) })
      .andWhere("event.topic0 = :signature", { signature: queryBytesFormat(eventSignature) })
    if (endTime) {
      query = query.andWhere("event.timestamp <= :endTime", { endTime });
    }
    return query.getMany();
  }

  /**
   * Queries indexer database for transactions on a smart contract based on function signature in a given timestamp range.
   * @param smartContract 
   * @param functionName 
   * @param startTime 
   * @param endTime 
   * @returns 
   */
  private async queryTransactions(smartContract: ContractDefinitions, functionName: string, startTime: number, endTime?: number): Promise<TLPTransaction[]> {
    const functionSignature = getFunctionSignature(smartContract.name, functionName);
    let query = this.entityManager
      .createQueryBuilder(TLPTransaction, "tx")
      .andWhere("tx.timestamp >= :startTime", { startTime })
      .andWhere("tx.to_address = :contractAddress", { contractAddress: queryBytesFormat(smartContract.address) })
      .andWhere("tx.function_sig = :signature", { signature: functionSignature })

    if (endTime) {
      query = query.andWhere("tx.timestamp <= :endTime", { endTime });
    }

    return query.getMany();
  }

  /**
   * Checks the indexer database for a given timestamp range, possibly with given timeout.
   * @param startTime 
   * @param endTime 
   * @param endTimeout 
   * @returns 
   */
  private async ensureEventRange(startTime: number, endTime: number, endTimeout?: number): Promise<BlockAssuranceResult> {
    const queryFirst = this.entityManager
      .createQueryBuilder(TLPState, "state")
      .andWhere("state.name = :name", { name: FIRST_DATABASE_INDEX_STATE });
    const firstState = await queryFirst.getOne();
    if (!firstState) {
      return BlockAssuranceResult.NOT_OK;
    }
    if (firstState.block_timestamp >= startTime) {
      return BlockAssuranceResult.NOT_OK;;
    }
    const queryLast = this.entityManager
      .createQueryBuilder(TLPState, "state")
      .andWhere("state.name = :name", { name: LAST_DATABASE_INDEX_STATE });
    const lastState = await queryLast.getOne();
    if (!lastState) {
      return BlockAssuranceResult.NOT_OK;;
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
   * Extracts RewardEpochStarted for a specific @param rewardEpochId from the indexer database, 
   * if the event is already indexed. Otherwise returns undefined.
   * The event is a low boundary event for the start of reward offers for rewardEpochId + 1.
   * @param rewardEpochId 
   * @returns 
   */
  public async getStartOfRewardEpochEvent(rewardEpochId: number): Promise<RewardEpochStarted | undefined> {
    const eventName = RewardEpochStarted.eventName;
    const startTime = EPOCH_SETTINGS.expectedRewardEpochStartTimeSec(rewardEpochId);
    const endTime = EPOCH_SETTINGS.expectedRewardEpochStartTimeSec(rewardEpochId + 2);
    const result = await this.queryEvents(CONTRACTS.FlareSystemManager, eventName, startTime, endTime);
    const events = result.map((event) => RewardEpochStarted.fromRawEvent(event));
    return events.find(event => event.rewardEpochId === rewardEpochId);
  }

  /**
   * Extracts event RandomAcquisitionStarted for a specific @param rewardEpochId from the indexer database, 
   * if the event is already indexed. Otherwise returns undefined.
   * The event is boundary event for the end of reward offers for the rewardEpochId.
   * @param rewardEpochId 
   * @returns 
   */
  public async getRandomAcquisitionStarted(rewardEpochId: number): Promise<RandomAcquisitionStarted | undefined> {
    const eventName = RandomAcquisitionStarted.eventName;
    const startTime = EPOCH_SETTINGS.expectedRewardEpochStartTimeSec(rewardEpochId - 1);
    const endTime = EPOCH_SETTINGS.expectedRewardEpochStartTimeSec(rewardEpochId + 1);
    const result = await this.queryEvents(CONTRACTS.FlareSystemManager, eventName, startTime, endTime);
    const events = result.map((event) => RandomAcquisitionStarted.fromRawEvent(event));
    return events.find(event => event.rewardEpochId === rewardEpochId);
  }

  /**
   * Assuming that the indexer has indexed all the events in the given timestamp range,
   * it extracts all the reward offers and inflation reward offers in the given timestamp range.
   * Timestamp range is usually obtained from timestamps of relevant events RewardEpochStarted and RandomAcquisitionStarted.
   * @param startTime 
   * @param endTime 
   * @returns 
   */
  public async getRewardOffers(startTime: number, endTime: number): Promise<RewardOffers> {
    const rewardOffersResults = await this.queryEvents(CONTRACTS.FtsoRewardOffersManager, RewardsOffered.eventName, startTime, endTime);
    const rewardOffers = rewardOffersResults.map((event) => RewardsOffered.fromRawEvent(event));

    const inflationOffersResults = await this.queryEvents(CONTRACTS.FtsoRewardOffersManager, InflationRewardsOffered.eventName, startTime, endTime);
    const inflationOffers = inflationOffersResults.map((event) => InflationRewardsOffered.fromRawEvent(event));

    return {
      rewardOffers,
      inflationOffers,
    };
  }

  /**
   * Extracts VotePowerBlockSelected event for a specific @param rewardEpochId from the indexer database, 
   * if the event is already indexed. Otherwise returns undefined.
   * This event is a low boundary event for the start of voter registration for rewardEpochId.
   * @param rewardEpochId 
   * @returns 
   */
  public async getVotePowerBlockSelectedEvent(rewardEpochId: number): Promise<VotePowerBlockSelected | undefined> {
    const eventName = VotePowerBlockSelected.eventName;
    const startTime = EPOCH_SETTINGS.expectedRewardEpochStartTimeSec(rewardEpochId - 1);
    const endTime = EPOCH_SETTINGS.expectedRewardEpochStartTimeSec(rewardEpochId + 1);
    const result = await this.queryEvents(CONTRACTS.FlareSystemManager, eventName, startTime, endTime);
    const events = result.map((event) => VotePowerBlockSelected.fromRawEvent(event));
    return events.find(event => event.rewardEpochId === rewardEpochId);
  }

  /**
   * Extracts SigningPolicyInitialized event on Relay contract for a specific @param rewardEpochId from the indexer database, 
   * if the event is already indexed. Otherwise returns undefined.
   * This event is a high boundary event for the end of voter registration for rewardEpochId.
   * @param rewardEpochId 
   * @returns 
   */
  public async getSigningPolicyInitializedEvent(rewardEpochId: number): Promise<SigningPolicyInitialized | undefined> {
    const eventName = SigningPolicyInitialized.eventName;
    const startTime = EPOCH_SETTINGS.expectedRewardEpochStartTimeSec(rewardEpochId - 1);
    const endTime = EPOCH_SETTINGS.expectedRewardEpochStartTimeSec(rewardEpochId + 1);
    const result = await this.queryEvents(CONTRACTS.Relay, eventName, startTime, endTime);
    const events = result.map((event) => SigningPolicyInitialized.fromRawEvent(event));
    return events.find(event => event.rewardEpochId === rewardEpochId);
  }

  // - all voter registration events and related in info events:
  //    - ["VoterRegistry", undefined, "VoterRegistered"],
  //    - ["FlareSystemCalculator", undefined, "VoterRegistrationInfo"],
  // Assumption: times are obtained from existing events, hence timestamps are correct.
  public async getFullVoterRegistrationInfoEvents(startTime: number, endTime: number): Promise<FullVoterRegistrationInfo[]> {
    const voterRegisteredResults = await this.queryEvents(CONTRACTS.VoterRegistry, VoterRegistered.eventName, startTime, endTime);
    const voterRegistered = voterRegisteredResults.map((event) => VoterRegistered.fromRawEvent(event));

    const voterRegistrationInfoResults = await this.queryEvents(CONTRACTS.FlareSystemCalculator, VoterRegistrationInfo.eventName, startTime, endTime);
    const voterRegistrationInfo = voterRegisteredResults.map((event) => VoterRegistrationInfo.fromRawEvent(event));

    if (voterRegistered.length !== voterRegistrationInfo.length) {
      throw new Error(`VoterRegistered and VoterRegistrationInfo events count mismatch: ${voterRegistered.length} !== ${voterRegistrationInfo.length}`);
    }
    voterRegistered.sort((a, b) => {
      if (a.voter < b.voter) {
        return -1
      }
      if (a.voter > b.voter) {
        return 1
      }
      return 0;
    });

    voterRegistrationInfo.sort((a, b) => {
      if (a.voter < b.voter) {
        return -1
      }
      if (a.voter > b.voter) {
        return 1
      }
      return 0;
    });
    let results: FullVoterRegistrationInfo[] = [];
    for (let i = 0; i < voterRegistered.length; i++) {
      if (voterRegistered[i].voter !== voterRegistrationInfo[i].voter) {
        throw new Error(`VoterRegistered and VoterRegistrationInfo events mismatch at index ${i}: ${voterRegistered[i].voter} !== ${voterRegistrationInfo[i].voter}`);
      }
      results.push({
        voterRegistered: voterRegistered[i],
        voterRegistrationInfo: voterRegistrationInfo[i],
      });
    }
    return results;
  }

  /**
   * Extracts all the submissions through function @param functionName in a given range of voting epochs.
   * @param functionName 
   * @param fromVotingEpochId
   * @param toVotingEpochId if not provided, it is assumed to be equal to fromVotingEpochId
   * @param endTimeout if not provided, it not timeout query is performed
   * @returns 
   */
  public async getSubmitionDataInRange(functionName: string, fromVotingEpochId: VotingEpochId, toVotingEpochId?: VotingEpochId, endTimeout?: number): Promise<SubmitResponse> {
    const realToVotingEpochId = toVotingEpochId ?? fromVotingEpochId;
    const startTime = EPOCH_SETTINGS.votingEpochStartSec(fromVotingEpochId)
    const endTime = EPOCH_SETTINGS.votingEpochEndSec(realToVotingEpochId)

    const ensureRange = await this.ensureEventRange(startTime, endTime, endTimeout);
    if (ensureRange === BlockAssuranceResult.NOT_OK) {
      return {
        queryResult: ensureRange,
        submits: []
      }
    }
    const transactionsResults = await this.queryTransactions(CONTRACTS.Submission, functionName, startTime, endTime);
    const submits: SubmissionData[] = transactionsResults.map((tx) => {
      const timestamp = tx.timestamp;
      const votingEpochId = EPOCH_SETTINGS.votingEpochForTimeSec(timestamp);
      const messages = decodePayloadMessageCalldata(tx);
      return {
        submitAddress: "0x" + tx.from_address,
        relativeTimestamp: timestamp - EPOCH_SETTINGS.votingEpochStartSec(votingEpochId),
        votingEpochId,
        messages,
      }
    })

    return {
      queryResult: ensureRange,
      submits
    }

  }

}
