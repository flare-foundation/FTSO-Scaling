import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import path from "path/posix";
import { CALCULATIONS_FOLDER } from "../../configs/networks";
import { IFUPartialRewardOfferForRound, IPartialRewardOfferForRound } from "../PartialRewardOffer";
import { RewardEpochDuration } from "../RewardEpochDuration";
import { bigIntReplacer, bigIntReviver } from "../big-number-serialization";
import { FDC_OFFERS_FILE, FU_OFFERS_FILE, OFFERS_FILE, TEMP_REWARD_EPOCH_FOLDER_PREFIX } from "./constants";

export interface FeedOffers<T> {
  readonly feedId: string;
  readonly offers: T[];
}
export interface OffersPerVotingRound<T> {
  readonly votingRoundId: number;
  readonly feedOffers: FeedOffers<T>[];
}

/**
 * Serializes granulated partial offer map to disk.
 * It creates necessary folders and structure of form
 *  `<calculationsFolder>/<rewardEpochId>/<votingRoundId>/OFFERS_FILE`
 * The `OFFERS_FILE` files contain relevant granulated offers for all feeds.
 */
export function serializeGranulatedPartialOfferMap(
  rewardEpochDuration: RewardEpochDuration,
  rewardOfferMap: Map<number, Map<string, IPartialRewardOfferForRound[] | IFUPartialRewardOfferForRound[]>>,
  regenerate = true,
  file = OFFERS_FILE,
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
    const offersPerVotingRound: OffersPerVotingRound<IPartialRewardOfferForRound | IFUPartialRewardOfferForRound> = {
      votingRoundId: i,
      feedOffers: [],
    };

    for (const [feedId, offers] of feedOffers.entries()) {
      offersPerVotingRound.feedOffers.push({
        feedId: feedId,
        offers,
      });
    }
    const offersPath = path.join(votingRoundFolder, file);
    writeFileSync(offersPath, JSON.stringify(offersPerVotingRound, bigIntReplacer));
  }
}

/**
 * Serializes granulated partial offer map to disk.
 * It creates necessary folders and structure of form
 *  `<calculationsFolder>/<rewardEpochId>/<votingRoundId>/OFFERS_FILE`
 * The `OFFERS_FILE` files contain relevant granulated offers for all feeds.
 */
export function serializeGranulatedPartialOfferMapForFDC(
  rewardEpochDuration: RewardEpochDuration,
  rewardOfferMap: Map<number, IPartialRewardOfferForRound[]>,
  regenerate = true,
  file = FDC_OFFERS_FILE,
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
    const votingRoundOffer = rewardOfferMap.get(i);
    if (!votingRoundOffer) {
      throw new Error(`Critical error: No offer for voting round ${i}`);
    }
    const offersPath = path.join(votingRoundFolder, file);
    writeFileSync(offersPath, JSON.stringify(votingRoundOffer, bigIntReplacer));
  }
}



/**
 * Creates necessary folders for reward epoch calculations. These include
 * the `<calculationsFolder>/<rewardEpochId>/<votingRoundId>` folders.
 */
export function createRewardCalculationFolders(
  rewardEpochDuration: RewardEpochDuration,
  tempRewardEpochFolder = false,
  calculationFolder = CALCULATIONS_FOLDER()
): void {
  if (!existsSync(calculationFolder)) {
    mkdirSync(calculationFolder, { recursive: true });
  }
  const rewardEpochFolder = path.join(
    calculationFolder,
    `${tempRewardEpochFolder ? TEMP_REWARD_EPOCH_FOLDER_PREFIX : ""}${rewardEpochDuration.rewardEpochId}`
  );
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
  const offersPerVotingRound: OffersPerVotingRound<IPartialRewardOfferForRound> = JSON.parse(
    readFileSync(offersPath, "utf8"),
    bigIntReviver
  );
  const feedOffers = new Map<string, IPartialRewardOfferForRound[]>();
  for (const feedOffer of offersPerVotingRound.feedOffers) {
    feedOffers.set(feedOffer.feedId, feedOffer.offers);
  }
  return feedOffers;
}

export function deserializeGranulatedPartialOfferMapForFastUpdates(
  rewardEpochId: number,
  votingRoundId: number,
  calculationFolder = CALCULATIONS_FOLDER()
): Map<string, IFUPartialRewardOfferForRound[]> {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  const votingRoundFolder = path.join(rewardEpochFolder, `${votingRoundId}`);
  const offersPath = path.join(votingRoundFolder, FU_OFFERS_FILE);
  if (!existsSync(offersPath)) {
    throw new Error(`Critical error: No granulated offers for voting round ${votingRoundId}`);
  }
  const offersPerVotingRound: OffersPerVotingRound<IFUPartialRewardOfferForRound> = JSON.parse(
    readFileSync(offersPath, "utf8"),
    bigIntReviver
  );
  const feedOffers = new Map<string, IFUPartialRewardOfferForRound[]>();
  for (const feedOffer of offersPerVotingRound.feedOffers) {
    feedOffers.set(feedOffer.feedId, feedOffer.offers);
  }
  return feedOffers;
}

export function deserializeOffersForFDC(
  rewardEpochId: number,
  votingRoundId: number,
  calculationFolder = CALCULATIONS_FOLDER()
): IPartialRewardOfferForRound[] {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  const votingRoundFolder = path.join(rewardEpochFolder, `${votingRoundId}`);
  const offersPath = path.join(votingRoundFolder, FDC_OFFERS_FILE);
  if (!existsSync(offersPath)) {
    throw new Error(`Critical error: No FDC offers for voting round ${votingRoundId}`);
  }
  const offersPerVotingRound: IPartialRewardOfferForRound[] = JSON.parse(
    readFileSync(offersPath, "utf8"),
    bigIntReviver
  );
  return offersPerVotingRound;
}

