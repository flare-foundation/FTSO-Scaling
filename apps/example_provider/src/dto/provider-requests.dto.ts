export class PriceFeedsRequest {
  // Feeds are represented as 8 byte hex strings
  feeds: string[];
}

export class FeedPriceData {
  feed: string;
  /**
   * price in base units as float
   */
  price: number;
}

export class PriceFeedsResponse {
  votingRoundId: number;
  feedPriceData: FeedPriceData[];
}

export class PriceFeedResponse {
  votingRoundId: number;
  feedPriceData: FeedPriceData;
}
