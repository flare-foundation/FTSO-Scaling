import { sleepFor } from "../time-utils";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_BACKOFF_MS = 500;
const DEFAULT_BACKOFF_MULTIPLIER = 2;

export async function retry<T>(
  f: () => T,
  maxRetriers: number = DEFAULT_MAX_RETRIES,
  initialBackOff: number = DEFAULT_INITIAL_BACKOFF_MS
): Promise<T> {
  let attempt = 1;
  let backoffMs = initialBackOff;
  while (true) {
    try {
      return await f();
    } catch (e) {
      attempt++;
      if (attempt > maxRetriers) {
        const retryError = new Error(`Failed to execute function after ${maxRetriers} attempts`);
        retryError.stack = (e as Error).stack;
        throw retryError;
      }
      await sleepFor(backoffMs);
      backoffMs *= DEFAULT_BACKOFF_MULTIPLIER;
    }
  }
}
