import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path/posix";
import { CALCULATIONS_FOLDER } from "../../configs/networks";
import { IRewardClaim } from "../RewardClaim";
import { bigIntReplacer, bigIntReviver } from "../big-number-serialization";
import { FINAL_REWARD_CLAIMS_FILE } from "./constants";

/**
 * Serializes final reward claims for a given reward epoch to disk.
 */
export function serializeFinalRewardClaims(
   rewardEpochId: number,
   rewardClaims: IRewardClaim[],
   calculationFolder = CALCULATIONS_FOLDER()
): void {
   const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
   const finalRewardClaimsPath = path.join(rewardEpochFolder, FINAL_REWARD_CLAIMS_FILE);
   writeFileSync(finalRewardClaimsPath, JSON.stringify(rewardClaims, bigIntReplacer));
}

/**
 * Deserializes final reward claims for a given reward epoch from disk.
 */
export function deserializeFinalRewardClaims(
   rewardEpochId: number,
   calculationFolder = CALCULATIONS_FOLDER()
): IRewardClaim[] {
   const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
   const finalRewardClaimsPath = path.join(rewardEpochFolder, FINAL_REWARD_CLAIMS_FILE);
   if (existsSync(finalRewardClaimsPath)) {
      throw new Error(`Final reward claims for epoch ${rewardEpochId} do not exist.`);
   }
   return JSON.parse(readFileSync(finalRewardClaimsPath, "utf8"), bigIntReviver);
}