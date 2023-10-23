import { Feed } from "../protocol/voting-types";

export interface IPriceFeed {
  getPriceForEpoch(priceEpochId: number): number;
  getFeedInfo(): Feed;
}