import fs from "fs";
import path from "path/posix";
import { CALCULATIONS_FOLDER } from "../../configs/networks";
import { IPartialRewardOfferForRound } from "../PartialRewardOffer";
import { RewardEpochDuration } from "../RewardEpochDuration";
import { bigIntReplacer, bigIntReviver } from "../big-number-serialization";
import { OFFERS_FILE } from "./constants";

export interface FeedOffers {
  readonly feedName: string;
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
  calculationFolder = CALCULATIONS_FOLDER()
): void {
  if (!fs.existsSync(calculationFolder)) {
    fs.mkdirSync(calculationFolder);
  }
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochDuration.rewardEpochId}`);
  if (fs.existsSync(rewardEpochFolder)) {
    fs.rmSync(rewardEpochFolder, { recursive: true });
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
    const offersPath = path.join(votingRoundFolder, OFFERS_FILE);
    fs.writeFileSync(offersPath, JSON.stringify(offersPerVotingRound, bigIntReplacer));
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
  if (!fs.existsSync(offersPath)) {
    throw new Error(`Critical error: No granulated offers for voting round ${votingRoundId}`);
  }
  const offersPerVotingRound: OffersPerVotingRound = JSON.parse(fs.readFileSync(offersPath, "utf8"), bigIntReviver);
  const feedOffers = new Map<string, IPartialRewardOfferForRound[]>();
  for (const feedOffer of offersPerVotingRound.feedOffers) {
    feedOffers.set(feedOffer.feedName, feedOffer.offers);
  }
  return feedOffers;
}
