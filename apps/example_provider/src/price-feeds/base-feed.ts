import { FeedPriceData } from "../dto/provider-requests.dto";

export abstract class BaseDataFeed {
  abstract getPrice(feed: string): Promise<FeedPriceData>;

  abstract getPrices(feeds: string[]): Promise<FeedPriceData[]>;
}
