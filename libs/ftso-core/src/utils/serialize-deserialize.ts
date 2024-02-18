import fs from "fs";
import path from "path/posix";
import { CALCULATIONS_FOLDER } from "../configs/networks";
import { IPartialRewardOffer } from "./PartialRewardOffer";
import { RewardEpochDuration } from "./RewardEpochDuration";
import { bigIntReplacer, bigIntReviver } from "./big-number-serialization";
import { IPartialRewardClaim } from "./RewardClaim";

export interface FeedOffers {
  readonly feedName: string;
  readonly offers: IPartialRewardOffer[];
}
export interface OffersPerVotingRound {
  readonly votingRoundId: number;
  readonly feedOffers: FeedOffers[];
}

export interface VotingRoundResult {
  readonly votingRoundId: number;
  readonly claims: IPartialRewardClaim[];
}

export function serializeGranulatedPartialOfferMap(
  rewardEpochDuration: RewardEpochDuration,
  rewardOfferMap: Map<number, Map<string, IPartialRewardOffer[]>>,
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

export function deserializeGranulatedPartialOfferMap(
  rewardEpochId: number,
  votingRoundId: number
): Map<string, IPartialRewardOffer[]> {
  const calculationFolder = CALCULATIONS_FOLDER();
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  const votingRoundFolder = path.join(rewardEpochFolder, `${votingRoundId}`);
  const offersPath = path.join(votingRoundFolder, `offers.json`);
  const offersPerVotingRound: OffersPerVotingRound = JSON.parse(fs.readFileSync(offersPath, "utf8"), bigIntReviver);
  const feedOffers = new Map<string, IPartialRewardOffer[]>();
  for (const feedOffer of offersPerVotingRound.feedOffers) {
    feedOffers.set(feedOffer.feedName, feedOffer.offers);
  }
  return feedOffers;
}

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

export function deserializePartialClaimsForVotingRoundId(
  rewardEpochId: number,
  votingRoundId: number
): IPartialRewardClaim[] {
  const calculationFolder = CALCULATIONS_FOLDER();
  const rewardEpochFolder = path.join(calculationFolder, `${rewardEpochId}`);
  const votingRoundFolder = path.join(rewardEpochFolder, `${votingRoundId}`);
  const claimsPath = path.join(votingRoundFolder, `claims.json`);
  return JSON.parse(fs.readFileSync(claimsPath, "utf8"), bigIntReviver);
}
