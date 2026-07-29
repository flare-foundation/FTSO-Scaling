import { Contract, JsonRpcProvider } from "ethers";
import { readFileSync } from "fs";
import { CONTRACTS, RPC_URL } from "../../../../contracts/src/constants";

/**
 * Totals RewardManager holds for a reward epoch.
 */
export interface RewardEpochTotals {
  totalRewardsWei: bigint;
  totalInflationRewardsWei: bigint;
}

/**
 * Reads `RewardManager.getRewardEpochTotals` over RPC.
 *
 * This is the only part of the reward calculation that needs a node: the funds credited to RewardManager are not
 * observable from the indexer database. `receiveRewards` emits no event, and it is reached through an internal
 * call, which the indexer's `transactions` table does not record. Everything else stays indexer-only.
 *
 * Returns undefined if the node cannot be reached, so that an environment problem is not mistaken for an
 * accounting mismatch. A reachable node returning a disagreeing total is a hard failure, handled by the caller.
 */
export async function getRewardEpochTotals(rewardEpochId: number): Promise<RewardEpochTotals | undefined> {
  try {
    const provider = new JsonRpcProvider(RPC_URL());
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const abi = JSON.parse(readFileSync(`abi/RewardManager.json`).toString()).abi;
    const rewardManager = new Contract(CONTRACTS.RewardManager.address, abi, provider);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const totals = await rewardManager.getRewardEpochTotals(rewardEpochId);
    return {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      totalRewardsWei: BigInt(totals[0]),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
      totalInflationRewardsWei: BigInt(totals[1]),
    };
  } catch (e) {
    return undefined;
  }
}
