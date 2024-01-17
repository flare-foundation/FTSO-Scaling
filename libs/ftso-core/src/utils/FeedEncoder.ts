export namespace FeedValueEncoder {
   export function encode(prices: (number | string)[]): string {
      return (
         "0x" +
         prices
            .map(price => {
               // check if price is in range
               let value = parseInt("" + price) + 2 ** 31;
               if (value <= 0 || value >= 2 ** 32) {
                  throw new Error(`Price ${price} is out of range`);
               }
               return value
                  .toString(16)
                  .padStart(8, "0")
            })
            .join("")
      );
   }

   export function decode(packedPrices: string, numberOfFeeds: number): number[] {
      let feedPrice =
         packedPrices
            .slice(2)
            .match(/(.{1,8})/g)
            ?.map(hex => parseInt(hex, 16)) || [];
      feedPrice = feedPrice.slice(0, numberOfFeeds);
      feedPrice = padEndArray(feedPrice, numberOfFeeds, 0);
      return feedPrice;
   }

   function padEndArray(array: any[], minLength: number, fillValue: any = undefined) {
      return Object.assign(new Array(minLength).fill(fillValue), array);
   }

}