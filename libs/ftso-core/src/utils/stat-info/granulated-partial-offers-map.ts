import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path/posix";
import { CALCULATIONS_FOLDER } from "../../configs/networks";
import { IPartialRewardOfferForRound } from "../PartialRewardOffer";
import { RewardEpochDuration } from "../RewardEpochDuration";
import { bigIntReplacer, bigIntReviver } from "../big-number-serialization";
import { OFFERS_FILE } from "./constants";

export interface FeedOffers {
  readonly feedId: string;
  readonly offers: IPartialRewardOfferForRound[];
}
export interface OffersPerVotingRound {
  readonly votingRoundId: number;
  readonly feedOffers: FeedOffers[];
}

/**
 * Serializes granulated partial offer map to disk.
 * It creates necessary folders and structure of form
 *  `<calculationsFolder>/<rewardEpochId>/<votingRoundId>/OFFERS_FILE`
 * The `OFFERS_FILE` files contain relevant granulated offers for all feeds.
 */
export function serializeGranulatedPartialOfferMap(
  rewardEpochDuration: RewardEpochDuration,
  rewardOfferMap: Map<number, Map<string, IPartialRewardOfferForRound[]>>,
  regenerate = true,
  calculationFolder = CALCULATIONS_FOLDER()
): void {
  if (!existsSync(calculationFolder)) {
    mkdirSync(calculationFolder);
  }
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochDuration.rewardEpochId}`);
  if (regenerate && existsSync(rewardEpochFolder)) {
    rmSync(rewardEpochFolder, { recursive: true });
  }
  if (!existsSync(rewardEpochFolder)) {
    mkdirSync(rewardEpochFolder);
  }
  for (let i = rewardEpochDuration.startVotingRoundId; i <= rewardEpochDuration.endVotingRoundId; i++) {
    const votingRoundFolder = path.join(rewardEpochFolder, `${i}`);
    if (!existsSync(votingRoundFolder)) {
      mkdirSync(votingRoundFolder);
    }
    const feedOffers = rewardOfferMap.get(i);
    if (!feedOffers) {
      throw new Error(`Critical error: No feed offers for voting round ${i}`);
    }
    const offersPerVotingRound: OffersPerVotingRound = {
      votingRoundId: i,
      feedOffers: [],
    };

    for (const [feedId, offers] of feedOffers.entries()) {
      offersPerVotingRound.feedOffers.push({
        feedId: feedId,
        offers,
      });
    }
    const offersPath = path.join(votingRoundFolder, OFFERS_FILE);
    writeFileSync(offersPath, JSON.stringify(offersPerVotingRound, bigIntReplacer));
  }
}

export function createRewardCalculationFolders(
  rewardEpochDuration: RewardEpochDuration,
  calculationFolder = CALCULATIONS_FOLDER()
): void {
  if (!existsSync(calculationFolder)) {
    mkdirSync(calculationFolder);
  }
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochDuration.rewardEpochId}`);
  if (existsSync(rewardEpochFolder)) {
    rmSync(rewardEpochFolder, { recursive: true });
  }
  mkdirSync(rewardEpochFolder);
  for (let i = rewardEpochDuration.startVotingRoundId; i <= rewardEpochDuration.endVotingRoundId; i++) {
    const votingRoundFolder = path.join(rewardEpochFolder, `${i}`);
    mkdirSync(votingRoundFolder);
  }
}

/**
 * Given a rewardEpochId and votingRoundId, it deserializes granulated partial offer map from disk.
 * In particular, it reads the `<calculationsFolder>/<rewardEpochId>/<votingRoundId>/OFFERS_FILE`
 * file and constructs the map.
 */
export function deserializeGranulatedPartialOfferMap(
  rewardEpochId: number,
  votingRoundId: number,
  calculationFolder = CALCULATIONS_FOLDER()
): Map<string, IPartialRewardOfferForRound[]> {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  const votingRoundFolder = path.join(rewardEpochFolder, `${votingRoundId}`);
  const offersPath = path.join(votingRoundFolder, OFFERS_FILE);
  if (!existsSync(offersPath)) {
    throw new Error(`Critical error: No granulated offers for voting round ${votingRoundId}`);
  }
  const offersPerVotingRound: OffersPerVotingRound = JSON.parse(readFileSync(offersPath, "utf8"), bigIntReviver);
  const feedOffers = new Map<string, IPartialRewardOfferForRound[]>();
  for (const feedOffer of offersPerVotingRound.feedOffers) {
    feedOffers.set(feedOffer.feedId, feedOffer.offers);
  }
  return feedOffers;
}
