import { Feed } from "../voting-types";

export interface ValueWithDecimals {
  readonly isEmpty: boolean;
  readonly value: number; // Never a float
  readonly decimals: number;
}

const EMPTY_FEED_VALUE = "".padStart(8, "0");

export namespace FeedValueEncoder {
  /**
   * Encodes values to a vector of 4-byte Excess-2^31 formatted values combined in a single hex string.
   * @param values Values in number format (float or integer)
   * @returns
   */
  export function encode(values: (number | undefined)[], feeds: Feed[], endStrip = true): string {
    if (values.length !== feeds.length) {
      throw new Error(`Number of values (${values.length}) does not match number of feeds (${feeds.length})`);
    }
    const result = values.map((formattedValue, index) => {
      if (formattedValue === undefined) {
        return EMPTY_FEED_VALUE; // undefined value is encoded as 0
      }
      const value = Math.round(formattedValue * 10 ** feeds[index].decimals) + 2 ** 31;
      if (value <= 0 || value >= 2 ** 32) {
        throw new Error(`Value ${formattedValue} is out of range for feed ${JSON.stringify(feeds[index])}`);
      }
      return value.toString(16).padStart(8, "0");
    });
    if (endStrip) {
      // Strip trailing empty feed values, but keep at least one so the encoded result is not empty
      while (result.length > 1 && result[result.length - 1] === EMPTY_FEED_VALUE) {
        result.pop();
      }
    }
    return "0x" + result.join("");
  }

  export function decode(packedValues: string, feeds: Feed[]): ValueWithDecimals[] {
    const unPrefixedValues = packedValues.startsWith("0x") ? packedValues.slice(2) : packedValues;
    if (unPrefixedValues.length % 8 !== 0) {
      throw new Error(`Invalid packed values length: ${unPrefixedValues.length}: must be multiple of 8`);
    }
    let feedValue = [...unPrefixedValues.match(/(.{1,8})/g)];
    feedValue = padEndArray(feedValue, feeds.length, EMPTY_FEED_VALUE);
    return feedValue.map((hex, index) => {
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
    if (value == undefined) return emptyFeed(decimals);

    return {
      isEmpty: false,
      value,
      decimals,
    };
  }
}

function padEndArray(array: any[], minLength: number, fillValue: any = undefined) {
  return Object.assign(new Array(minLength).fill(fillValue), array);
}
