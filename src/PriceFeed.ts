export interface PriceFeedConfig {
  period: number;
  factor: number;
  variance: number;
}

export class PriceFeed {
  priceFeedConfig!: PriceFeedConfig;

  constructor(config: PriceFeedConfig) {
    this.priceFeedConfig = config;
  }

  getPriceForEpoch(epochId: number) {
    let noise = (Math.random() - 0.5) * this.priceFeedConfig.variance;
    let result = Math.floor((Math.sin(epochId / this.priceFeedConfig.period) + 1) * this.priceFeedConfig.factor + noise);
    return Math.max(0, result);
  }
}