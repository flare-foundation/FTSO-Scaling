import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path/posix";
import { IRewardClaim } from "../RewardClaim";
import { bigIntReplacer, bigIntReviver } from "../../../../ftso-core/src/utils/big-number-serialization";
import { AGGREGATED_CLAIMS_FILE } from "./constants";
import { CALCULATIONS_FOLDER } from "../../constants";

/**
 * Serializes aggregated claims for a given voting round to disk.
 * In particular it stores the claims in
 * `<calculationsFolder>/<rewardEpochId>/<votingRoundId>/AGGREGATED_CLAIMS_FILE`
 */
export function serializeAggregatedClaimsForVotingRoundId(
  rewardEpochId: number,
  votingRoundId: number,
  rewardClaims: IRewardClaim[],
  calculationFolder = CALCULATIONS_FOLDER()
): void {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  const votingRoundFolder = path.join(rewardEpochFolder, `${votingRoundId}`);
  if (!existsSync(votingRoundFolder)) {
    mkdirSync(votingRoundFolder);
  }
  const claimsPath = path.join(votingRoundFolder, AGGREGATED_CLAIMS_FILE);
  writeFileSync(claimsPath, JSON.stringify(rewardClaims, bigIntReplacer));
}

/**
 * Deserializes aggregated claims for a given voting round from disk.
 * In particular it reads the claims from
 * `<calculationsFolder>/<rewardEpochId>/<votingRoundId>/AGGREGATED_CLAIMS_FILE`
 */
export function deserializeAggregatedClaimsForVotingRoundId(
  rewardEpochId: number,
  votingRoundId: number,
  calculationFolder = CALCULATIONS_FOLDER()
): IRewardClaim[] {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  const votingRoundFolder = path.join(rewardEpochFolder, `${votingRoundId}`);
  const claimsPath = path.join(votingRoundFolder, AGGREGATED_CLAIMS_FILE);
  if (!existsSync(claimsPath)) {
    throw new Error(
      `Aggregated claims for voting round ${votingRoundId} of reward epoch ${rewardEpochId} do not exist.`
    );
  }
  return JSON.parse(readFileSync(claimsPath, "utf8"), bigIntReviver) as IRewardClaim[];
}
/**
 * Checks if aggregated claims for a given voting round exist on disk.
 */
export function aggregatedClaimsForVotingRoundIdExist(
  rewardEpochId: number,
  votingRoundId: number,
  calculationFolder = CALCULATIONS_FOLDER()
): boolean {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  const votingRoundFolder = path.join(rewardEpochFolder, `${votingRoundId}`);
  const claimsPath = path.join(votingRoundFolder, AGGREGATED_CLAIMS_FILE);
  return existsSync(claimsPath);
}
