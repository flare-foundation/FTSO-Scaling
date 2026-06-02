/**
 * Helpers for logging attacker-controllable submission data safely.
 *
 * Reveal/commit payloads are hex calldata of unbounded size. Dumping them in full
 * (e.g. via `JSON.stringify`) lets a malicious oversized submission flood operator
 * logs, so these helpers only ever emit a short, bounded summary.
 */

// "0x" + 8 bytes of hex.
const PAYLOAD_PREVIEW_CHARS = 18;

/** Minimal shape needed to summarise a submission for logging. */
interface LoggableSubmission {
  messages?: { payload?: string }[];
}

/** Short, log-safe preview of an unbounded, attacker-controllable hex payload. */
export function payloadPreview(payload: unknown): string {
  if (typeof payload !== "string") {
    return "<none>";
  }
  return `${payload.slice(0, PAYLOAD_PREVIEW_CHARS)}… (${payload.length} chars)`;
}

/**
 * Returns a short, log-safe summary of a submission data array: the entry count plus
 * a bounded preview of the first payload. Never emits full payload bytes.
 */
export function formatSubmissionsForLog(items: readonly LoggableSubmission[] | undefined): string {
  const count = items?.length ?? 0;
  if (count === 0) {
    return `count=0`;
  }
  return `count=${count}, firstPayload=${payloadPreview(items[0]?.messages?.[0]?.payload)}`;
}
