import { Feed } from "./voting-types";

export interface IPriceFeed {
  getPriceForEpoch(priceEpochId: number): number;
  getFeedInfo(): Feed;
}
