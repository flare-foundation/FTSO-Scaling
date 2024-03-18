import { FeedPriceData } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";

const baseValue = 0.05;

export class RandomFeed implements BaseDataFeed {
  async getPrice(feed: string): Promise<FeedPriceData> {
    return {
      feed,
      price: baseValue * (0.5 + Math.random()),
    };
  }

  async getPrices(feeds: string[]): Promise<FeedPriceData[]> {
    const promises = feeds.map(feed => this.getPrice(feed));
    return Promise.all(promises);
  }
}
