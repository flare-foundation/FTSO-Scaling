export class FeedId {
  type: number;
  name: string;
}

export class FeedValuesRequest {
  feeds: FeedId[];
}

export class FeedValueData {
  feed: FeedId;
  /** Value in base units as float */
  value: number;
}

export class FeedValuesResponse {
  votingRoundId: number;
  data: FeedValueData[];
}

export class FeedValueResponse {
  votingRoundId: number;
  data: FeedValueData;
}
