import { CONTRACTS } from "../configs/networks";
import { decodeEvent } from "../utils/EncodingUtils";
import { RawEventConstructible } from "./RawEventConstructible";

export class FastUpdateFeeds extends RawEventConstructible {
  static eventName = "FastUpdateFeeds";
  constructor(data: any) {
    super();
    this.votingRoundId = Number(data.votingRoundId);
    this.feedValues = data.feedValues.map((v: any) => BigInt(v));
    this.feedDecimals = data.feedDecimals.map((v: any) => Number(v));
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
  feedValues: bigint[];

  // feed decimals
  feedDecimals: number[];
}
