import { Fee } from "ccxt";
import { Feed } from "../voting-types";
import { FeedValueEncoder, PriceWithDecimals } from "./FeedEncoder";
import { IPayloadMessage, PayloadMessage } from "./PayloadMessage";

export interface IRevealData {
   readonly random: string;
   readonly feeds: Feed[];
   readonly prices?: number[];
   readonly pricesWithDecimals?: PriceWithDecimals[];
   readonly encodedPrices: string;
}

export namespace RevealData {
   export function encode(revealData: IRevealData, endStrip = true): string {
      if (!/^0x[0-9a-f]{64}$/i.test(revealData.random)) {
         throw Error(`Invalid random format: ${revealData.random}`);
      }
      return revealData.random + revealData.encodedPrices ? revealData.encodedPrices.slice(2) : FeedValueEncoder.encode(revealData.prices, revealData.feeds, endStrip);
   }

   export function decode(encoded: string, feeds: Feed[]): IRevealData {
      if (!/^0x[0-9a-f]*$/i.test(encoded) || encoded.length % 2 !== 0) {
         throw Error(`Invalid encoding format: ${encoded}`);
      }
      return {
         random: encoded.slice(0, 66),
         feeds,          
         pricesWithDecimals: FeedValueEncoder.decode("0x" + encoded.slice(66), feeds),
         encodedPrices: "0x" + encoded.slice(66).padEnd(8 * feeds.length, "0"),
      };
   }

   export function decodePayloadMessages(encoded: string, feeds: Feed[]): IPayloadMessage<IRevealData>[] {
      const messages = PayloadMessage.decode(encoded);
      return messages.map((message) => {  
         return {
            ...message,
            payload: RevealData.decode(message.payload, feeds),
         }
      });
   }

}
