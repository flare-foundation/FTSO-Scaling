import { Feed } from "../voting-types";

export interface ValueWithDecimals {
  readonly isEmpty: boolean;
  readonly value: number; // Never a float
  readonly decimals: number; //
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
    const result = prices.map((price, index) => {
      if (price === undefined) {
        return EMPTY_FEED_VALUE; // undefined value is encoded as 0
      }
      const value = Math.round(price * 10 ** feeds[index].decimals) + 2 ** 31;
      if (value <= 0 || value >= 2 ** 32) {
        throw new Error(`Price ${price} is out of range for feed ${JSON.stringify(feeds[index])}`);
      }
      return value.toString(16).padStart(8, "0");
    });
    if (endStrip) {
      while (result.length > 0 && result[result.length - 1] === "00000000") {
        result.pop();
      }
    }
    return "0x" + result.join("");
  }

  export function decode(packedPrices: string, feeds: Feed[]): ValueWithDecimals[] {
    const unPrefixedPrices = packedPrices.startsWith("0x") ? packedPrices.slice(2) : packedPrices;
    if (unPrefixedPrices.length % 8 !== 0) {
      throw new Error(`Invalid packed prices length: ${unPrefixedPrices.length}: must be multiple of 8`);
    }
    let feedPrice = [...unPrefixedPrices.match(/(.{1,8})/g)];
    feedPrice = padEndArray(feedPrice, feeds.length, EMPTY_FEED_VALUE);
    return feedPrice.map((hex, index) => {
      const isEmpty = hex === EMPTY_FEED_VALUE;
      const result: ValueWithDecimals = {
        isEmpty,
        value: isEmpty ? 0 : parseInt(hex, 16) - 2 ** 31,
        decimals: feeds[index].decimals,
      };
      return result;
    });
  }

  export function emptyFeed(decimals: number): ValueWithDecimals {
    return {
      isEmpty: true,
      value: 0,
      decimals: decimals,
    };
  }

  export function emptyFeeds(feeds: Feed[]): ValueWithDecimals[] {
    return feeds.map(feed => emptyFeed(feed.decimals));
  }

  export function feedForValue(value: number, decimals: number) {
    return {
      isEmpty: true,
      value,
      decimals,
    };
  }
}

function padEndArray(array: any[], minLength: number, fillValue: any = undefined) {
  return Object.assign(new Array(minLength).fill(fillValue), array);
}
