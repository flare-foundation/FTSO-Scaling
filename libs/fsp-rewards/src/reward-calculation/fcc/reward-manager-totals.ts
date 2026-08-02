import { BaseContract, Contract, InterfaceAbi, isError, JsonRpcProvider } from "ethers";
import { readFileSync } from "fs";
import { CONTRACTS } from "../../../../contracts/src/constants";
import { RPC_URL } from "../../constants";

/**
 * Totals RewardManager holds for a reward epoch.
 */
export interface RewardEpochTotals {
  totalRewardsWei: bigint;
  totalInflationRewardsWei: bigint;
}

interface RewardManagerContract extends BaseContract {
  getRewardEpochTotals(rewardEpochId: number): Promise<readonly [bigint, bigint]>;
}

const NODE_TRANSPORT_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** Only transient node/transport failures may make the independent on-chain check unavailable. */
export function isRewardManagerTransportError(error: unknown): boolean {
  const seen = new Set<unknown>();
  const pending: unknown[] = [error];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current !== "object" || current === null || seen.has(current)) {
      continue;
    }
    seen.add(current);
    if (isError(current, "TIMEOUT")) {
      return true;
    }
    const nodeError = current as {
      cause?: unknown;
      code?: unknown;
      error?: unknown;
      info?: { error?: unknown };
      syscall?: unknown;
    };
    if (typeof nodeError.code === "string" && NODE_TRANSPORT_ERROR_CODES.has(nodeError.code)) {
      return true;
    }
    // A sandbox or host policy can reject socket creation with EPERM/EACCES. Require the socket syscall so the same
    // code from opening the ABI file is still a fatal configuration error.
    if (
      (nodeError.code === "EPERM" || nodeError.code === "EACCES") &&
      (nodeError.syscall === "connect" || nodeError.syscall === "getaddrinfo")
    ) {
      return true;
    }
    pending.push(nodeError.cause, nodeError.error, nodeError.info?.error);
  }
  return false;
}

/**
 * Reads `RewardManager.getRewardEpochTotals` over RPC.
 *
 * This is the only part of the reward calculation that needs a node: the funds credited to RewardManager are not
 * observable from the indexer database. `receiveRewards` emits no event, and it is reached through an internal
 * call, which the indexer's `transactions` table does not record. Everything else stays indexer-only.
 *
 * Returns undefined only for a node transport failure, so that a transient environment problem is not mistaken for
 * an accounting mismatch. Configuration, ABI, decoding, and contract-call errors propagate and fail finalization;
 * a reachable node returning a disagreeing total is a hard failure handled by the caller.
 */
export async function getRewardEpochTotals(rewardEpochId: number): Promise<RewardEpochTotals | undefined> {
  // Parse configuration before opening a provider so local configuration failures cannot be classified as RPC
  // availability failures.
  const artifact = JSON.parse(readFileSync(`abi/RewardManager.json`).toString()) as { abi: InterfaceAbi };
  const provider = new JsonRpcProvider(RPC_URL());
  try {
    const rewardManager = new Contract(
      CONTRACTS.RewardManager.address,
      artifact.abi,
      provider
    ) as unknown as RewardManagerContract;
    const totals = await rewardManager.getRewardEpochTotals(rewardEpochId);
    return {
      totalRewardsWei: BigInt(totals[0]),
      totalInflationRewardsWei: BigInt(totals[1]),
    };
  } catch (error) {
    if (isRewardManagerTransportError(error)) {
      return undefined;
    }
    throw error;
  } finally {
    // JsonRpcProvider retries network detection in the background. Always stop it so a skipped check cannot keep a
    // one-shot reward calculation process alive indefinitely.
    provider.destroy();
  }
}
