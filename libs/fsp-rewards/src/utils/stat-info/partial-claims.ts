import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path/posix";
import { IPartialRewardClaim } from "../RewardClaim";
import { bigIntReplacer, bigIntReviver } from "../../../../ftso-core/src/utils/big-number-serialization";
import { CLAIMS_FILE } from "./constants";
import { CALCULATIONS_FOLDER } from "../../constants";

/**
 * Serializes a list of partial claims for a given voting round to disk.
 * In particular it stores the claims in
 *  `<calculationsFolder>/<rewardEpochId>/<votingRoundId>/CLAIMS_FILE`
 */
export function serializePartialClaimsForVotingRoundId(
  rewardEpochId: number,
  votingRoundId: number,
  rewardClaims: IPartialRewardClaim[],
  calculationFolder = CALCULATIONS_FOLDER()
): void {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  const votingRoundFolder = path.join(rewardEpochFolder, `${votingRoundId}`);
  if (!existsSync(votingRoundFolder)) {
    mkdirSync(votingRoundFolder);
  }
  const claimsPath = path.join(votingRoundFolder, CLAIMS_FILE);
  writeFileSync(claimsPath, JSON.stringify(rewardClaims, bigIntReplacer));
}

/**
 * Deserializes partial claims for a given voting round from disk.
 * In particular it reads the claims from
 * `<calculationsFolder>/<rewardEpochId>/<votingRoundId>/CLAIMS_FILE`
 */
export function deserializePartialClaimsForVotingRoundId(
  rewardEpochId: number,
  votingRoundId: number,
  calculationFolder = CALCULATIONS_FOLDER()
): IPartialRewardClaim[] {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  const votingRoundFolder = path.join(rewardEpochFolder, `${votingRoundId}`);
  const claimsPath = path.join(votingRoundFolder, CLAIMS_FILE);
  if (!existsSync(claimsPath)) {
    throw new Error(`Claims file for voting round ${votingRoundId} does not exist.`);
  }
  return JSON.parse(readFileSync(claimsPath, "utf8"), bigIntReviver);
}
