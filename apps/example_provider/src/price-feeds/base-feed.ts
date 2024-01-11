import { Feed } from "../../../../libs/ftso-core/src/voting-types";
import { FeedPriceData } from "../dto/provider-requests.dto";


export abstract class BaseDataFeed {
  abstract getPrice(feed: Feed): Promise<FeedPriceData>;

  abstract getPrices(feeds: Feed[]): Promise<FeedPriceData[]>;
}