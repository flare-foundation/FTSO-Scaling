import { Injectable } from "@nestjs/common";
import { IPriceProvider } from "../../../../libs/ftso-core/src/IPriceFeed";
import { feedId } from "../../../../libs/ftso-core/src/utils/voting-utils";
import { Feed } from "../../../../libs/ftso-core/src/voting-types";

@Injectable()
export class PriceService {
  readonly priceProvidersByFeed = new Map<string, IPriceProvider>();

  constructor(priceProviders: IPriceProvider[]) {
    priceProviders.forEach(provider => {
      this.priceProvidersByFeed.set(feedId(provider.feed), provider);
    });
  }

  getPrice(feed: Feed): number | undefined {
    return 1;
    const provider = this.priceProvidersByFeed.get(feedId(feed));
    if (!provider) {
      return undefined;
    }
    return provider.getCurrentPrice();
  }
}
