import { ValueWithDecimals } from "../../libs/ftso-core/src/utils/FeedValueEncoder";
import { deserializeDataForRewardCalculation } from "../../libs/ftso-core/src/utils/stat-info/reward-calculation-data";
import { deserializeRewardEpochInfo } from "../../libs/ftso-core/src/utils/stat-info/reward-epoch-info";
import { Feed, MedianCalculationSummary } from "../../libs/ftso-core/src/voting-types";
import { flrFormat } from "../../test/utils/reward-claim-summaries";

export interface FeedDataInRewardEpoch {
  feed?: Feed;
  votingRoundId: number;
  medianSummary: MedianCalculationSummary;
  votes: (ValueWithDecimals | undefined)[];
}

export interface RewardEpochDataFeeds {
  rewardEpochId: number;
  feed?: Feed;
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
    : feedNameOrId === "-"
    ? undefined
    : rewardEpochInfo.canonicalFeedOrder[parseInt(feedNameOrId)].id;
  const start = startVotingRoundId ?? rewardEpochInfo.signingPolicy.startVotingRoundId;
  let end = endVotingRoundId ?? rewardEpochInfo.endVotingRoundId;
  if (start < rewardEpochInfo.signingPolicy.startVotingRoundId) {
    throw new Error("Invalid start voting round id");
  }
  if (end > rewardEpochInfo.endVotingRoundId) {
    throw new Error("Invalid end voting round id");
  }
  if (start > end) {
    throw new Error("Invalid range");
  }

  const feedPositionInList = rewardEpochInfo.canonicalFeedOrder.findIndex(feed => feed.id === feedId);
  const feed = rewardEpochInfo.canonicalFeedOrder[feedPositionInList]; // can be undefined
  let startFeedPos = 0;
  let endFeedPos = rewardEpochInfo.canonicalFeedOrder.length - 1;
  if (feedPositionInList < 0) {
    if (start !== end) {
      throw new Error("Feed not found");
    }
  } else {
    startFeedPos = feedPositionInList;
    endFeedPos = feedPositionInList;
  }

  const feedDataEntries: FeedDataInRewardEpoch[] = [];
  if (end === undefined) {
    end = Number.POSITIVE_INFINITY; // Number
  }
  for (let feedPos = startFeedPos; feedPos <= endFeedPos; feedPos++) {
    for (let votingRoundId = start; votingRoundId <= end; votingRoundId++) {
      let data;
      try {
        data = deserializeDataForRewardCalculation(rewardEpochId, votingRoundId);
      } catch (e) {
        // finish when no more data - relevant for the last partially calculated reward epoch
        break;
      }
      const submissionAddressToValue = new Map<string, ValueWithDecimals>();
      for (const record of data.dataForCalculations.validEligibleReveals) {
        const feedValue = record.data?.valuesWithDecimals?.[feedPos];
        if (feedValue) {
          submissionAddressToValue.set(record.submitAddress.toLowerCase(), feedValue);
        }
      }
      const votes: (ValueWithDecimals | undefined)[] = [];
      for (const address of data.dataForCalculations.orderedVotersSubmitAddresses) {
        votes.push(submissionAddressToValue.get(address.toLowerCase()));
      }
      const feed = feedPositionInList < 0 ? rewardEpochInfo.canonicalFeedOrder[feedPos] : undefined;
      const feedData: FeedDataInRewardEpoch = {
        votingRoundId,
        medianSummary: data.medianSummaries[feedPos],
        votes,
        feed,
      };
      feedDataEntries.push(feedData);
    }
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

function toFeedName(hex: string) {
  let result = "";
  for (let i = 4; i < hex.length; i += 2) {
    const charHexCode = hex.slice(i, i + 2);
    if (charHexCode === "00") {
      continue;
    }
    result += String.fromCharCode(parseInt(charHexCode, 16));
  }
  return result;
}
export function printFeedSummary(feedData: RewardEpochDataFeeds) {
  for (const feedDataEntry of feedData.feedData) {
    const votes = feedDataEntry.votes.map(vote => (vote ? (vote.isEmpty ? "x" : vote.value) : "-")).join(",");
    if (feedData.feed !== undefined) {
      console.log(
        `${feedDataEntry.votingRoundId}: ${feedDataEntry.medianSummary.finalMedian.value} (${
          feedDataEntry.medianSummary.quartile1.value
        }, ${feedDataEntry.medianSummary.quartile3.value}), ${flrFormat(
          feedDataEntry.medianSummary.participatingWeight
        )} | ${votes}`
      );
    } else {
      console.log(
        `${toFeedName(feedDataEntry.feed.id)}: ${feedDataEntry.medianSummary.finalMedian.value} (${
          feedDataEntry.medianSummary.quartile1.value
        }, ${feedDataEntry.medianSummary.quartile3.value}), ${flrFormat(
          feedDataEntry.medianSummary.participatingWeight
        )} | ${votes}`
      );
    }
  }
  if (feedData.feed !== undefined) {
    console.log(`Feed: ${toFeedName(feedData.feed.id)} (${feedData.feed.id})`);
  }
  console.log("------ Interpretation ------");
  console.log(`voting round id: median (q1, q3), weight | votes`);
}
