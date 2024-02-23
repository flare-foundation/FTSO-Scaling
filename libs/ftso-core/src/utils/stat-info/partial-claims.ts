import fs from "fs";
import path from "path/posix";
import { CALCULATIONS_FOLDER } from "../../configs/networks";
import { IPartialRewardClaim } from "../RewardClaim";
import { bigIntReplacer, bigIntReviver } from "../big-number-serialization";
import { CLAIMS_FILE } from "./constants";

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
  if (!fs.existsSync(votingRoundFolder)) {
    fs.mkdirSync(votingRoundFolder);
  }
  const claimsPath = path.join(votingRoundFolder, CLAIMS_FILE);
  fs.writeFileSync(claimsPath, JSON.stringify(rewardClaims, bigIntReplacer));
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
  return JSON.parse(fs.readFileSync(claimsPath, "utf8"), bigIntReviver);
}
