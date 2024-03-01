import { Feed } from "../voting-types";
import { unPrefix0x } from "./EncodingUtils";
import { FeedValueEncoder, ValueWithDecimals } from "./FeedValueEncoder";
import { IPayloadMessage } from "../../../fsp-utils/src/PayloadMessage";

export interface IRevealData {
  readonly random: string;
  readonly feeds: Feed[];
  readonly prices?: number[];
  readonly pricesWithDecimals?: ValueWithDecimals[];
  readonly encodedValues: string;
}

export namespace RevealData {
  export function encode(revealData: IRevealData): string {
    if (!/^0x[0-9a-f]{64}$/i.test(revealData.random)) {
      throw Error(`Invalid random format: ${revealData.random}`);
    }
    return revealData.random + unPrefix0x(revealData.encodedValues);
  }

  export function decode(encoded: string, feeds: Feed[]): IRevealData {
    if (!/^0x[0-9a-f]*$/i.test(encoded) || encoded.length % 2 !== 0) {
      throw Error(`Invalid encoding format: ${encoded}`);
    }
    return {
      random: encoded.slice(0, 66),
      feeds,
      pricesWithDecimals: FeedValueEncoder.decode("0x" + encoded.slice(66), feeds),
      encodedValues: "0x" + encoded.slice(66),
    };
  }

  export function decodePayloadMessage(message: IPayloadMessage<string>, feeds: Feed[]): IPayloadMessage<IRevealData> {
    return {
      ...message,
      payload: RevealData.decode(message.payload, feeds),
    };
  }
}
