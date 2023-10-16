import { Feed } from "../lib/voting-interfaces";

export interface IPriceFeed {
  getPriceForEpoch(priceEpochId: number): number;
  getFeedInfo(): Feed;
}