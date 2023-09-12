import { Feed } from "../voting-interfaces";

export interface IPriceFeed {
  getPriceForEpoch(priceEpochId: number): number;
  getFeedInfo(): Feed;
}