// External user facing response for FDC round reports.
// Field names follow the Flare explorer's FDC round JSON (snake_case), except the
// explorer's internal database `pk` which is replaced by the `id` object below.

import { ExternalResponseStatusEnum } from "./data-provider-responses.dto";

/** Identity of the AttestationRequest event, in place of the explorer's database pk. */
export interface FdcAttestationRequestId {
  /** 0x-prefixed transaction hash; null when the indexer log row has no linked transaction. */
  tx_hash: string | null;
  block_number: number;
  log_index: number;
  /** Block timestamp, unix seconds. */
  timestamp: number;
}

export interface FdcAttestationTypeSourceDto {
  /** Decoded attestation type (e.g. "Payment"); null when request data is shorter than 64 bytes. */
  attestation_type: string | null;
  /** Decoded source id (e.g. "XRP"); null when request data is shorter than 64 bytes. */
  source_id: string | null;
}

/**
 * "EXECUTED" when the supporting bitvote weight exceeds the signing policy threshold —
 * an approximation of the explorer's finalized-consensus-based value, computed from
 * bitvotes only (no finalization/signature data).
 */
export type FdcIsProved = "EXECUTED" | "UNCONFIRMED";

export interface FdcAttestationRequest {
  id: FdcAttestationRequestId;
  attestation_type_source: FdcAttestationTypeSourceDto;
  is_proved: FdcIsProved;
}

export interface FdcAttestationRequestEntry {
  attestation_request: FdcAttestationRequest;
  /** Number of identical requests (byte-identical data) folded into this entry within the round. */
  count: number;
  /** Supporting signing weight / total signing weight of all registered voters, in [0, 1]. */
  weight: number;
}

export interface FdcEntity {
  /** EIP-55 checksummed voter identity address. */
  identity_address: string;
  /** Always null: provider display metadata is off-chain and not served by this API. */
  display_name: null;
  logo_url: null;
  listed: false;
}

export interface FdcEntityBitVector {
  entity: FdcEntity;
  /**
   * One flag per deduplicated attestation request, in request order. Normally of length
   * `count`; a provider whose bitvote declares a different request count is rendered at
   * its declared length (as on the explorer) and excluded from `weight` calculations.
   */
  bit_vector: boolean[];
}

export interface FdcRoundReportPayload {
  attestation_requests: FdcAttestationRequestEntry[];
  entity_bit_vectors: FdcEntityBitVector[];
  /** Deduplicated attestation request count (= every bit_vector's length). */
  count: number;
}

interface FdcRoundReportResponseOk extends FdcRoundReportPayload {
  status: ExternalResponseStatusEnum.OK;
}

interface FdcRoundReportResponseTooEarly {
  status: ExternalResponseStatusEnum.TOO_EARLY;
}

interface FdcRoundReportResponseNotAvailable {
  status: ExternalResponseStatusEnum.NOT_AVAILABLE;
}

export type FdcRoundReportResponse =
  | FdcRoundReportResponseOk
  | FdcRoundReportResponseTooEarly
  | FdcRoundReportResponseNotAvailable;
