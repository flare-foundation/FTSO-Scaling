import { Feed } from "../voting-interfaces";
import { IPriceFeed } from "./IPriceFeed";

export interface RandomPriceFeedConfig {
  period: number;
  factor: number;
  variance: number;
  feedInfo: Feed;
}

export class RandomPriceFeed implements IPriceFeed{
  priceFeedConfig!: RandomPriceFeedConfig;

  constructor(config: RandomPriceFeedConfig) {
    this.priceFeedConfig = config;
  }

  getFeedInfo(): Feed {
    return this.priceFeedConfig.feedInfo;
  }

  getPriceForEpoch(epochId: number) {
    let noise = (Math.random() - 0.5) * this.priceFeedConfig.variance;
    let result = Math.floor((Math.sin(epochId / this.priceFeedConfig.period) + 1) * this.priceFeedConfig.factor + noise);
    return Math.max(0, result);
  }
}