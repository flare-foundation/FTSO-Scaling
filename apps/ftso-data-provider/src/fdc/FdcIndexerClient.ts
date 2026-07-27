import { CONTRACTS } from "../../../../libs/contracts/src/constants";
import { AttestationRequest } from "../../../../libs/contracts/src/events/AttestationRequest";
import { EPOCH_SETTINGS } from "../../../../libs/ftso-core/src/constants";
import {
  BlockAssuranceResult,
  IndexerClient,
  IndexerResponse,
  queryBytesFormat,
} from "../../../../libs/ftso-core/src/IndexerClient";
import { TLPEvents } from "../../../../libs/ftso-core/src/orm/entities";

/**
 * A decoded AttestationRequest event together with the identity of the emitting log,
 * used in place of the explorer's database `pk`.
 */
export interface FdcAttestationRequestRecord {
  request: AttestationRequest;
  /** 0x-prefixed transaction hash, or null when the log row has no linked transaction. */
  txHash: string | null;
  blockNumber: number;
  logIndex: number;
  timestamp: number;
}

export class FdcIndexerClient extends IndexerClient {
  /**
   * Returns all FdcHub AttestationRequest events emitted during @param votingRoundId in
   * chronological order. Modeled on IndexerClientForRewarding.getAttestationRequestEvents
   * (single round variant), with a join on the emitting transaction so the response can
   * carry tx hashes; not imported from libs/fsp-rewards — see fdc-round-utils.ts.
   */
  public async getFdcAttestationRequestEvents(
    votingRoundId: number,
    endTimeout?: number
  ): Promise<IndexerResponse<FdcAttestationRequestRecord[]>> {
    const startTime = EPOCH_SETTINGS().votingEpochStartSec(votingRoundId);
    const endTime = EPOCH_SETTINGS().votingEpochStartSec(votingRoundId + 1) - 1;
    const status = await this.ensureBlockRange(startTime, endTime, endTimeout);
    if (status === BlockAssuranceResult.NOT_OK) {
      return { status };
    }
    const eventSignature = this.encoding.getEventSignature(CONTRACTS.FdcHub.name, AttestationRequest.eventName);
    const events = await this.entityManager
      .createQueryBuilder(TLPEvents, "event")
      .leftJoinAndSelect("event.transaction_id", "tx")
      .andWhere("event.timestamp >= :startTime", { startTime })
      .andWhere("event.timestamp <= :endTime", { endTime })
      .andWhere("event.address = :contractAddress", { contractAddress: queryBytesFormat(CONTRACTS.FdcHub.address) })
      .andWhere("event.topic0 = :signature", { signature: queryBytesFormat(eventSignature) })
      .orderBy("event.timestamp", "ASC")
      .addOrderBy("event.block_number", "ASC")
      .addOrderBy("event.log_index", "ASC")
      .getMany();
    const data = events.map((event) => ({
      request: AttestationRequest.fromRawEvent(event),
      txHash: event.transaction_id?.hash ? "0x" + event.transaction_id.hash : null,
      blockNumber: event.block_number,
      logIndex: event.log_index,
      timestamp: event.timestamp,
    }));
    return { status, data };
  }
}
