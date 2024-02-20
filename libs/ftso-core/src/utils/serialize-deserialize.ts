import fs from "fs";
import path from "path/posix";
import { CALCULATIONS_FOLDER } from "../configs/networks";
import { IPartialRewardOfferForRound } from "./PartialRewardOffer";
import { IPartialRewardClaim, IRewardClaim } from "./RewardClaim";
import { RewardEpochDuration } from "./RewardEpochDuration";
import { bigIntReplacer, bigIntReviver } from "./big-number-serialization";

export interface FeedOffers {
  readonly feedName: string;
  readonly offers: IPartialRewardOfferForRound[];
}
export interface OffersPerVotingRound {
  readonly votingRoundId: number;
  readonly feedOffers: FeedOffers[];
}

export interface VotingRoundResult {
  readonly votingRoundId: number;
  readonly claims: IPartialRewardClaim[];
}

/**
 * Serializes granulated partial offer map to disk.
 * It creates necessary folders and structure of form
 *  `<calculationsFolder>/<rewardEpochId>/<votingRoundId>/offers.json`
 * The `offer.json` files contain relevant granulated offers for all feeds.
 */
export function serializeGranulatedPartialOfferMap(
  rewardEpochDuration: RewardEpochDuration,
  rewardOfferMap: Map<number, Map<string, IPartialRewardOfferForRound[]>>,
  calculationFolder = CALCULATIONS_FOLDER()
): void {
  if (!fs.existsSync(calculationFolder)) {
    fs.mkdirSync(calculationFolder);
  }
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochDuration.rewardEpochId}`);
  if (fs.existsSync(rewardEpochFolder)) {
    fs.rmdirSync(rewardEpochFolder, { recursive: true });
  }
  fs.mkdirSync(rewardEpochFolder);
  for (let i = rewardEpochDuration.startVotingRoundId; i <= rewardEpochDuration.endVotingRoundId; i++) {
    const votingRoundFolder = path.join(rewardEpochFolder, `${i}`);
    fs.mkdirSync(votingRoundFolder);
    const feedOffers = rewardOfferMap.get(i);
    if (!feedOffers) {
      throw new Error(`Critical error: No feed offers for voting round ${i}`);
    }
    const offersPerVotingRound: OffersPerVotingRound = {
      votingRoundId: i,
      feedOffers: [],
    };

    for (const [feedName, offers] of feedOffers.entries()) {
      offersPerVotingRound.feedOffers.push({
        feedName,
        offers,
      });
    }
    const offersPath = path.join(votingRoundFolder, `offers.json`);
    fs.writeFileSync(offersPath, JSON.stringify(offersPerVotingRound, bigIntReplacer));
  }
}

/**
 * Given a rewardEpochId and votingRoundId, it deserializes granulated partial offer map from disk.
 * In particular, it reads the `<calculationsFolder>/<rewardEpochId>/<votingRoundId>/offers.json`
 * file and constructs the map.
 */
export function deserializeGranulatedPartialOfferMap(
  rewardEpochId: number,
  votingRoundId: number,
  calculationFolder = CALCULATIONS_FOLDER()
): Map<string, IPartialRewardOfferForRound[]> {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  const votingRoundFolder = path.join(rewardEpochFolder, `${votingRoundId}`);
  const offersPath = path.join(votingRoundFolder, `offers.json`);
  const offersPerVotingRound: OffersPerVotingRound = JSON.parse(fs.readFileSync(offersPath, "utf8"), bigIntReviver);
  const feedOffers = new Map<string, IPartialRewardOfferForRound[]>();
  for (const feedOffer of offersPerVotingRound.feedOffers) {
    feedOffers.set(feedOffer.feedName, feedOffer.offers);
  }
  return feedOffers;
}

/**
 * Serializes a list of partial claims for a given voting round to disk.
 * In particular it stores the claims in
 *  `<calculationsFolder>/<rewardEpochId>/<votingRoundId>/claims.json`
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
  const claimsPath = path.join(votingRoundFolder, `claims.json`);
  fs.writeFileSync(claimsPath, JSON.stringify(rewardClaims, bigIntReplacer));
}

/**
 * Deserializes partial claims for a given voting round from disk.
 * In particular it reads the claims from
 * `<calculationsFolder>/<rewardEpochId>/<votingRoundId>/claims.json`
 */
export function deserializePartialClaimsForVotingRoundId(
  rewardEpochId: number,
  votingRoundId: number,
  calculationFolder = CALCULATIONS_FOLDER()
): IPartialRewardClaim[] {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  const votingRoundFolder = path.join(rewardEpochFolder, `${votingRoundId}`);
  const claimsPath = path.join(votingRoundFolder, `claims.json`);
  return JSON.parse(fs.readFileSync(claimsPath, "utf8"), bigIntReviver);
}

/**
 * Serializes aggregated claims for a given voting round to disk.
 * In particular it stores the claims in
 * `<calculationsFolder>/<rewardEpochId>/<votingRoundId>/aggregated-claims.json`
 */
export function serializeAggregatedClaimsForVotingRoundId(
  rewardEpochId: number,
  votingRoundId: number,
  rewardClaims: IRewardClaim[],
  calculationFolder = CALCULATIONS_FOLDER()
): void {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  const votingRoundFolder = path.join(rewardEpochFolder, `${votingRoundId}`);
  if (!fs.existsSync(votingRoundFolder)) {
    fs.mkdirSync(votingRoundFolder);
  }
  const claimsPath = path.join(votingRoundFolder, `aggregated-claims.json`);
  fs.writeFileSync(claimsPath, JSON.stringify(rewardClaims, bigIntReplacer));
}

/**
 * Deserializes aggregated claims for a given voting round from disk.
 * In particular it reads the claims from
 * `<calculationsFolder>/<rewardEpochId>/<votingRoundId>/aggregated-claims.json`
 */
export function deserializeAggregatedClaimsForVotingRoundId(
  rewardEpochId: number,
  votingRoundId: number,
  calculationFolder = CALCULATIONS_FOLDER()
): IRewardClaim[] {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  const votingRoundFolder = path.join(rewardEpochFolder, `${votingRoundId}`);
  const claimsPath = path.join(votingRoundFolder, `aggregated-claims.json`);
  return JSON.parse(fs.readFileSync(claimsPath, "utf8"), bigIntReviver);
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
  const claimsPath = path.join(votingRoundFolder, `aggregated-claims.json`);
  return fs.existsSync(claimsPath);
}

/**
 * Destroys storage for a given reward epoch. It removes the folder.
 */
export function destroyStorage(rewardEpochId: number, calculationFolder = CALCULATIONS_FOLDER()) {
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  if (fs.existsSync(rewardEpochFolder)) {
    fs.rmdirSync(rewardEpochFolder, { recursive: true });
  }
}
