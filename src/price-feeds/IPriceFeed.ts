import { Feed } from "../voting-interfaces";

export interface IPriceFeed {
  getPriceForEpoch(epochId: number): number;
  getFeedInfo(): Feed;
}