import { sleepFor } from "../time-utils";

const RETRY_TIMEOUT_MS = 500;
const DEFAULT_MAX_RETRIES = 3;

export async function retry<T>(
  f: () => T,
  maxRetriers: number = DEFAULT_MAX_RETRIES,
  retryTimeout: number = RETRY_TIMEOUT_MS
): Promise<T> {
  let attempt = 1;
  while (true) {
    try {
      return await f();
    } catch (e) {
      attempt++;
      if (attempt > maxRetriers) {
        throw new Error(`Failed to execute function after ${maxRetriers} attempts: ${e}`);
      }
      await sleepFor(retryTimeout);
    }
  }
}
