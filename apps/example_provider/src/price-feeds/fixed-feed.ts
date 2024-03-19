import { Logger } from "@nestjs/common";
import { FeedPriceData } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";

/** Safe default value that will not overflow for all default feeds. */
const DEFAULT_PRICE = 0.01;

export class FixedFeed implements BaseDataFeed {
  private readonly logger = new Logger(FixedFeed.name);

  constructor() {
    this.logger.warn(`Initializing FixedFeed, will return ${DEFAULT_PRICE} for all feeds.`);
  }
  async getPrice(feed: string): Promise<FeedPriceData> {
    return {
      feed,
      price: DEFAULT_PRICE,
    };
  }

  async getPrices(feeds: string[]): Promise<FeedPriceData[]> {
    const promises = feeds.map(feed => this.getPrice(feed));
    return Promise.all(promises);
  }
}
