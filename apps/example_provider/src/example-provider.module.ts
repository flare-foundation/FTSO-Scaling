import { Module } from "@nestjs/common";
import { ExampleProviderService } from "./example-provider-service";
import { ExampleProviderController } from "./example-provider.controller";
import { CcxtFeed } from "./price-feeds/ccxt-provider-service";
import { RandomFeed } from "./price-feeds/random-feed";
import { BaseDataFeed } from "./price-feeds/base-feed";
import { FixedFeed } from "./price-feeds/fixed-feed";

@Module({
  imports: [],
  controllers: [ExampleProviderController],
  providers: [
    {
      provide: "EXAMPLE_PROVIDER_SERVICE",
      useFactory: async () => {
        let priceFeed: BaseDataFeed;

        if (process.env.PRICE_PROVIDER_IMPL == "fixed") {
          priceFeed = new FixedFeed();
        } else if (process.env.PRICE_PROVIDER_IMPL == "random") {
          priceFeed = new RandomFeed();
        } else {
          // Ccxt service
          const priceFeed = new CcxtFeed();
          await priceFeed.start();
        }

        const service = new ExampleProviderService(priceFeed);
        return service;
      },
    },
  ],
})
export class RandomExampleProviderModule {}
