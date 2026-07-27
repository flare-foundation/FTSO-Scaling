import { AttestationRequest } from "../../../../libs/contracts/src/events/AttestationRequest";

/**
 * FDC (Flare Data Connector) protocol id, 200 on every supported network.
 * Defined locally instead of importing libs/fsp-rewards/src/constants.ts: that
 * module evaluates reward-calculation env constants at import time and throws
 * for NETWORK=from-env deployments that don't set them, so nothing in this app
 * may import from libs/fsp-rewards (directly or transitively).
 */
export const FDC_PROTOCOL_ID = 200;

export interface FdcAttestationTypeSource {
  attestation_type: string | null;
  source_id: string | null;
}

/**
 * Given a list of attestation request events it calculates the list of indices of same requests.
 * The first index in such a sub-list is the representative of the same requests.
 * Requests are duplicates iff their full `data` hex strings are byte-identical.
 *
 * Copied from libs/fsp-rewards/src/reward-calculation/fdc/fdc-utils.ts (uniqueRequestsIndices) —
 * see FDC_PROTOCOL_ID above for why it is not imported.
 */
export function uniqueRequestsIndices(attestationRequests: AttestationRequest[]): number[][] {
  const encountered = new Map<string, number>();
  const result: number[][] = [];
  for (let i = 0; i < attestationRequests.length; i++) {
    const request = attestationRequests[i];
    if (encountered.get(request.data) === undefined) {
      encountered.set(request.data, result.length);
      result.push([i]);
    } else {
      result[encountered.get(request.data)].push(i);
    }
  }
  return result;
}

/**
 * Given a number representing a bitvote it returns the indices of accepted attestation
 * requests (LSB-first: bit i corresponds to deduplicated request index i).
 * Throws if any bit beyond `len` is set.
 *
 * Copied from libs/fsp-rewards/src/reward-calculation/fdc/fdc-utils.ts (bitVoteIndicesNum).
 */
export function bitVoteIndicesNum(bitVoteNum: bigint, len: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < len; i++) {
    if (bitVoteNum % 2n === 1n) {
      result.push(i);
    }
    bitVoteNum /= 2n;
  }
  if (bitVoteNum !== 0n) {
    throw new Error(`bitVoteNum not fully consumed: ${bitVoteNum}`);
  }
  return result;
}

/**
 * Parses an FDC bitvote payload: "0x" + uint16 attestation request count + bit vector bytes.
 * Throws on malformed hex. The declared count is NOT validated against the round's request
 * count here — a mismatching bitvote (buggy/outdated provider) is still rendered at its
 * declared length by the explorer, just excluded from weight calculations; that policy
 * lives in the service.
 *
 * Note: the 2-byte count prefix matches how the reward calculation reads bitvotes
 * (payload.slice(6), e.g. fdc-utils.isConsensusVoteDominated); fdc-utils.bitVoteIndices
 * reads a 1-byte prefix but is unused code — deliberately not replicated here.
 */
export function parseBitVotePayload(payload: string): { declaredCount: number; bits: bigint } {
  if (
    typeof payload !== "string" ||
    !/^0x[0-9a-f]*$/i.test(payload) ||
    payload.length < 6 ||
    payload.length % 2 !== 0
  ) {
    throw new Error(`Malformed bitvote payload: ${payload}`);
  }
  const declaredCount = parseInt(payload.slice(2, 6), 16);
  const bits = payload.slice(6);
  return { declaredCount, bits: bits.length === 0 ? 0n : BigInt("0x" + bits) };
}

/**
 * Decodes the attestation type and source id from the first 64 bytes of attestation
 * request data (two zero-padded UTF-8 bytes32 values). Returns nulls when the data is
 * shorter than 64 bytes. Same decoding as the FTSO reward calculation process
 * (apps/ftso-reward-calculation-process/src/libs/attestation-type-appearances.ts).
 */
export function decodeAttestationTypeAndSource(data: string): FdcAttestationTypeSource {
  if (!data || data.length < 130) {
    return { attestation_type: null, source_id: null };
  }
  return {
    attestation_type: Buffer.from(data.slice(2, 66), "hex").toString("utf8").replaceAll("\0", ""),
    source_id: Buffer.from(data.slice(66, 130), "hex").toString("utf8").replaceAll("\0", ""),
  };
}

/**
 * Expands accepted request indices into a boolean vector over the deduplicated request list.
 */
export function toBitVector(indices: number[], length: number): boolean[] {
  const vector = new Array<boolean>(length).fill(false);
  for (const index of indices) {
    vector[index] = true;
  }
  return vector;
}
