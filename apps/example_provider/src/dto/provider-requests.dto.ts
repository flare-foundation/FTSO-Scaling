import { Feed } from "../../../../libs/ftso-core/src/voting-types";

export interface PriceFeedsRequest {
  votingRoundId: number;
  priceFeeds: Feed[];
}

export interface FeedPriceData {
  feed: Feed;
  price: number; // TODO: consider BigInt
}

export interface PriceFeedsResponse {
  votingRoundId: number;
  feedPriceData: FeedPriceData[];
}

export interface PriceFeedResponse {
  votingRoundId: number;
  feedPriceData: FeedPriceData;
}
