import { ValueWithDecimals } from "../../libs/ftso-core/src/utils/FeedValueEncoder";
import { deserializeDataForRewardCalculation } from "../../libs/ftso-core/src/utils/stat-info/reward-calculation-data";
import { deserializeRewardEpochInfo } from "../../libs/ftso-core/src/utils/stat-info/reward-epoch-info";
import { Feed, MedianCalculationSummary } from "../../libs/ftso-core/src/voting-types";
import { flrFormat } from "../../test/utils/reward-claim-summaries";

export interface FeedDataInRewardEpoch {
  votingRoundId: number;
  medianSummary: MedianCalculationSummary;
  votes: (ValueWithDecimals | undefined)[];
}

export interface RewardEpochDataFeeds {
  rewardEpochId: number;
  feed: Feed;
  startVotingRoundId: number;
  endVotingRoundId: number;
  feedData: FeedDataInRewardEpoch[];
}

export async function feedSummary(
  rewardEpochId: number,
  feedNameOrId: string,
  startVotingRoundId?: number,
  endVotingRoundId?: number
): Promise<RewardEpochDataFeeds> {
  // const data = await deserializeDataForRewardCalculation(rewardEpochId, );
  const rewardEpochInfo = deserializeRewardEpochInfo(rewardEpochId);
  const feedId = feedNameOrId.startsWith("0x")
    ? feedNameOrId
    : rewardEpochInfo.canonicalFeedOrder[parseInt(feedNameOrId)].name;
  const start = startVotingRoundId ?? rewardEpochInfo.signingPolicy.startVotingRoundId;
  const end = endVotingRoundId ?? rewardEpochInfo.endVotingRoundId;
  if (start < rewardEpochInfo.signingPolicy.startVotingRoundId) {
    throw new Error("Invalid start voting round id");
  }
  if (end > rewardEpochInfo.endVotingRoundId) {
    throw new Error("Invalid end voting round id");
  }
  if (start > end) {
    throw new Error("Invalid range");
  }

  const feedPosition = rewardEpochInfo.canonicalFeedOrder.findIndex(feed => feed.name === feedId);
  const feed = rewardEpochInfo.canonicalFeedOrder[feedPosition];
  if (feedPosition < 0) {
    throw new Error("Feed not found");
  }
  const feedDataEntries: FeedDataInRewardEpoch[] = [];
  for (let votingRoundId = start; votingRoundId <= end; votingRoundId++) {
    const data = deserializeDataForRewardCalculation(rewardEpochId, votingRoundId);
    const submissionAddressToValue = new Map<string, ValueWithDecimals>();
    for (const record of data.dataForCalculations.validEligibleReveals) {
      const feedValue = record.data?.pricesWithDecimals?.[feedPosition];
      if (feedValue) {
        submissionAddressToValue.set(record.submitAddress.toLowerCase(), feedValue);
      }
    }
    const votes: (ValueWithDecimals | undefined)[] = [];
    for (const address of data.dataForCalculations.orderedVotersSubmitAddresses) {
      votes.push(submissionAddressToValue.get(address.toLowerCase()));
    }
    const feedData: FeedDataInRewardEpoch = {
      votingRoundId,
      medianSummary: data.medianSummaries[feedPosition],
      votes,
    };
    feedDataEntries.push(feedData);
  }
  const result: RewardEpochDataFeeds = {
    rewardEpochId,
    feed,
    startVotingRoundId: start,
    endVotingRoundId: end,
    feedData: feedDataEntries,
  };
  return result;
}

export function printFeedSummary(feedData: RewardEpochDataFeeds) {
  console.log(`Feed: ${feedData.feed.name}`);
  for (const feedDataEntry of feedData.feedData) {
    const votes = feedDataEntry.votes.map(vote => (vote ? (vote.isEmpty ? "x" : vote.value) : "-")).join(",");
    console.log(
      `${feedDataEntry.votingRoundId}: ${feedDataEntry.medianSummary.finalMedianPrice.value} (${
        feedDataEntry.medianSummary.quartile1Price.value
      }, ${feedDataEntry.medianSummary.quartile3Price.value}), ${flrFormat(
        feedDataEntry.medianSummary.participatingWeight
      )} | ${votes}`
    );
  }
  console.log("------ Interpretation ------");
  console.log(`voting round id: median (q1, q3), weight | votes`);
}
