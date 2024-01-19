import { Feed } from "../voting-types";

export interface PriceWithDecimals {
   readonly price: number;
   readonly decimals: number;
}

const EMPTY_FEED_VALUE = "".padStart(8, "0");
export namespace FeedValueEncoder {
   /**
    * Encodes price to a vector of 4-byte Excess-2^31 formated values combined in a single hex string.
    * @param prices Prices in number format (float or integer)
    * @returns 
    */
   export function encode(prices: (number | undefined)[], feeds: Feed[], endStrip = true): string {
      if (prices.length !== feeds.length) {
         throw new Error(`Number of prices (${prices.length}) does not match number of feeds (${feeds.length})`);
      }
      let result = prices
         .map(price => {
            if (price === undefined) {
               return EMPTY_FEED_VALUE;   // undefined value is encoded as 0
            }
            let value = Math.round(price * 10 ** feeds[0].decimals) + 2 ** 31;
            if (value <= 0 || value >= 2 ** 32) {
               throw new Error(`Price ${price} is out of range`);
            }
            return value
               .toString(16)
               .padStart(8, "0")
         });
      if (endStrip) {
         while (result.length > 0 && result[result.length - 1] === "00000000") {
            result.pop();
         }
      }
      return "0x" + result.join("");
   }

   export function decode(packedPrices: string, feeds: Feed[]): PriceWithDecimals[] {
      let feedPrice = [...packedPrices.slice(2).match(/(.{1,8})/g)];
      feedPrice = padEndArray(feedPrice, feeds.length, EMPTY_FEED_VALUE);
      return feedPrice.map(hex => {
         return {
            price: parseInt(hex, 16) - 2 ** 31,
            decimals: feeds[0].decimals,
         } as PriceWithDecimals
      })
   }

   function padEndArray(array: any[], minLength: number, fillValue: any = undefined) {
      return Object.assign(new Array(minLength).fill(fillValue), array);
   }

}