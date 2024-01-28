import { Feed } from "../../../../libs/ftso-core/src/voting-types";
import { FeedPriceData } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";

export interface RandomPriceFeedConfig {
  period: number;
  factor: number;
  variance: number;
  feedInfo: Feed;
}

export class RandomFeed implements BaseDataFeed {
  private readonly priceFeedConfig: Omit<RandomPriceFeedConfig, "feedInfo">;

  constructor() {
    const index = 1;
    this.priceFeedConfig = {
      period: 10,
      factor: 1000 * (index + 1),
      variance: 100,
    };
  }

  async getPrice(feed: string): Promise<FeedPriceData> {
    const noise = (Math.random() - 0.5) * this.priceFeedConfig.variance;
    const result = Math.floor(
      (Math.sin(Date.now() / this.priceFeedConfig.period) + 1) * this.priceFeedConfig.factor + noise
    );
    return {
      feed,
      price: result,
    };
  }

  async getPrices(feeds: string[]): Promise<FeedPriceData[]> {
    const promises = feeds.map(feed => this.getPrice(feed));
    return Promise.all(promises);
  }
}
