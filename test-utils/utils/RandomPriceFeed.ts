import { Feed } from "../../src/protocol/voting-types";
import { IPriceFeed } from "../../src/price-feeds/IPriceFeed";

export interface RandomPriceFeedConfig {
  period: number;
  factor: number;
  variance: number;
  feedInfo: Feed;
}

export class RandomPriceFeed implements IPriceFeed {
  priceFeedConfig!: RandomPriceFeedConfig;

  constructor(config: RandomPriceFeedConfig) {
    this.priceFeedConfig = config;
  }

  getFeedInfo(): Feed {
    return this.priceFeedConfig.feedInfo;
  }

  getPriceForEpoch(priceEpochId: number) {
    const noise = (Math.random() - 0.5) * this.priceFeedConfig.variance;
    const result = Math.floor(
      (Math.sin(priceEpochId / this.priceFeedConfig.period) + 1) * this.priceFeedConfig.factor + noise
    );
    return Math.max(0, result);
  }
}

/**
 * All FTSO clients will have the same price feed configs, but each client will have different price feeds
 * due to randomness noise.
 */
export function createPriceFeedConfigs(symbols: Feed[]) {
  const priceFeedConfigs: RandomPriceFeedConfig[] = [];
  for (let j = 0; j < symbols.length; j++) {
    const priceFeedConfig = {
      period: 10,
      factor: 1000 * (j + 1),
      variance: 100,
      feedInfo: symbols[j],
    } as RandomPriceFeedConfig;
    priceFeedConfigs.push(priceFeedConfig);
  }
  return priceFeedConfigs;
}
