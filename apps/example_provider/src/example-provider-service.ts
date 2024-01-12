import { Injectable } from "@nestjs/common";
import { Feed } from "../../../libs/ftso-core/src/voting-types";
import { FeedPriceData } from "./dto/provider-requests.dto";
import { BaseDataFeed } from "./price-feeds/base-feed";

@Injectable()
export class ExampleProviderService {
  constructor(private readonly priceFeed: BaseDataFeed) {}

  async getPrice(feed: string): Promise<FeedPriceData> {
    return this.priceFeed.getPrice(feed);
  }

  async getPrices(feeds: string[]): Promise<FeedPriceData[]> {
    return this.priceFeed.getPrices(feeds);
  }
}
