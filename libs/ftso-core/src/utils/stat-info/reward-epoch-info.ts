import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path/posix";
import { ISigningPolicy } from "../../../../fsp-utils/src/SigningPolicy";
import { RewardEpoch } from "../../RewardEpoch";
import { CALCULATIONS_FOLDER, EPOCH_SETTINGS } from "../../configs/networks";
import { FullVoterRegistrationInfo, RewardOffers } from "../../events";
import { Feed } from "../../voting-types";
import { bigIntReplacer, bigIntReviver } from "../big-number-serialization";
import { REWARD_EPOCH_INFO_FILE, TEMP_REWARD_EPOCH_FOLDER_PREFIX } from "./constants";
import { FUInflationRewardsOffered } from "../../events/FUInflationRewardsOffered";
import { IncentiveOffered } from "../../events/IncentiveOffered";

export interface RewardEpochInfo {
  rewardEpochId: number;
  signingPolicy: ISigningPolicy;
  voterRegistrationInfo: FullVoterRegistrationInfo[];
  canonicalFeedOrder: Feed[];
  rewardOffers: RewardOffers;
  votePowerBlock: number;
  votePowerTimestamp: number;
  expectedStartVotingRoundId: number;
  expectedEndVotingRoundId: number;
  endVotingRoundId?: number;
  fuInflationRewardsOffered?: FUInflationRewardsOffered;
  fuIncentivesOffered?: IncentiveOffered[];
}

export function getRewardEpochInfo(
  rewardEpoch: RewardEpoch,
  endVotingRoundId?: number,
  fuInflationRewardsOffered?: FUInflationRewardsOffered,
  fuIncentivesOffered?: IncentiveOffered[]
): RewardEpochInfo {
  const voterRegistrationInfo: FullVoterRegistrationInfo[] = [];
  for (const signingAddress of rewardEpoch.signingPolicy.voters) {
    const identityAddress = rewardEpoch.signingAddressToVoter.get(signingAddress.toLowerCase());
    if (!identityAddress) {
      throw new Error(`Critical error: No identity address for signing address ${signingAddress}`);
    }
    const registrationInfo = rewardEpoch.voterToRegistrationInfo.get(identityAddress.toLowerCase());
    voterRegistrationInfo.push(registrationInfo);
  }
  const result: RewardEpochInfo = {
    rewardEpochId: rewardEpoch.rewardEpochId,
    signingPolicy: rewardEpoch.signingPolicy,
    voterRegistrationInfo,
    canonicalFeedOrder: rewardEpoch.canonicalFeedOrder,
    rewardOffers: rewardEpoch.rewardOffers,
    votePowerBlock: rewardEpoch.votePowerBlock,
    votePowerTimestamp: rewardEpoch.votePowerBlockTimestamp,
    expectedStartVotingRoundId: EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpoch.rewardEpochId),
    expectedEndVotingRoundId:
      EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpoch.rewardEpochId + 1) - 1,
    endVotingRoundId,
    fuInflationRewardsOffered,
    fuIncentivesOffered,
  };
  return result;
}

/**
 * Serializes reward epoch info to disk.
 * In particular it stores the info in
 *  `<calculationsFolder>/<rewardEpochId>/REWARD_EPOCH_INFO_FILE`
 */
export function serializeRewardEpochInfo(
  rewardEpochId: number,
  rewardEpochInfo: RewardEpochInfo,
  tempRewardEpochFolder = false,
  calculationFolder = CALCULATIONS_FOLDER()
): void {
  if (!existsSync(calculationFolder)) {
    mkdirSync(calculationFolder, { recursive: true });
  }
  const rewardEpochFolder = path.join(
    calculationFolder,
    `${tempRewardEpochFolder ? TEMP_REWARD_EPOCH_FOLDER_PREFIX : ""}${rewardEpochId}`
  );
  if (!existsSync(rewardEpochFolder)) {
    mkdirSync(rewardEpochFolder);
  }
  const rewardEpochInfoPath = path.join(rewardEpochFolder, REWARD_EPOCH_INFO_FILE);
  writeFileSync(rewardEpochInfoPath, JSON.stringify(rewardEpochInfo, bigIntReplacer));
}

/**
 * Deserializes reward epoch info from disk.
 * In particular it reads the info from
 * `<calculationsFolder>/<rewardEpochId>/REWARD_EPOCH_INFO_FILE`
 */
export function deserializeRewardEpochInfo(
  rewardEpochId: number,
  tempRewardEpochFolder = false,
  calculationFolder = CALCULATIONS_FOLDER()
): RewardEpochInfo {
  const rewardEpochFolder = path.join(
    calculationFolder,
    `${tempRewardEpochFolder ? TEMP_REWARD_EPOCH_FOLDER_PREFIX : ""}${rewardEpochId}`
  );
  const rewardEpochInfoPath = path.join(rewardEpochFolder, REWARD_EPOCH_INFO_FILE);
  if (!existsSync(rewardEpochInfoPath)) {
    throw new Error(`Reward epoch info file not found at ${rewardEpochInfoPath}`);
  }
  return JSON.parse(readFileSync(rewardEpochInfoPath, "utf8"), bigIntReviver);
}
