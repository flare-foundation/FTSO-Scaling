import { CONTRACTS } from "../configs/networks";
import { decodeEvent } from "../utils/EncodingUtils";
import { RawEventConstructible } from "./RawEventConstructible";

export class FastUpdateFeeds extends RawEventConstructible {
  static eventName = "FastUpdateFeeds";
  constructor(data: any) {
    super();
    this.votingRoundId = Number(data.votingEpochId);
    this.feeds = data.feeds.map((v: any) => BigInt(v));
    this.decimals = data.decimals.map((v: any) => Number(v));
  }

  static fromRawEvent(event: any): FastUpdateFeeds {
    return decodeEvent<FastUpdateFeeds>(
      CONTRACTS.FastUpdater.name,
      FastUpdateFeeds.eventName,
      event,
      (data: any) => new FastUpdateFeeds(data)
    );
  }

  // votingRoundId
  votingRoundId: number;

  // Feed values in the order of feedIds
  feeds: bigint[];

  // feed decimals
  decimals: number[];
}
