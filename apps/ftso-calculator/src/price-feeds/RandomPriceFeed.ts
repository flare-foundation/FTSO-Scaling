import { IPriceProvider } from "../../../../libs/ftso-core/src/IPriceFeed";
import { Feed } from "../../../../libs/ftso-core/src/voting-types";

interface RandomPriceFeedConfig {
  period: number;
  factor: number;
  variance: number;
}

export class RandomPriceFeed implements IPriceProvider {
  private readonly priceFeedConfig!: RandomPriceFeedConfig;

  constructor(readonly feed: Feed, index: number) {
    this.priceFeedConfig = {
      period: 10,
      factor: 1000 * (index + 1),
      variance: 100,
    };
  }

  getCurrentPrice(): number {
    const noise = (Math.random() - 0.5) * this.priceFeedConfig.variance;
    const result = Math.floor(
      (Math.sin(Date.now() / this.priceFeedConfig.period) + 1) * this.priceFeedConfig.factor + noise
    );
    return Math.max(0, result);
  }
}
