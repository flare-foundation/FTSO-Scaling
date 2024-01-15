import { Module } from "@nestjs/common";
import { ExampleProviderService } from "./example-provider-service";
import { ExampleProviderController } from "./example-provider.controller";
import { CcxtFeed } from "./price-feeds/ccxt-provider-service";

@Module({
  imports: [],
  controllers: [ExampleProviderController],
  providers: [
    {
      provide: "EXAMPLE_PROVIDER_SERVICE",
      useFactory: async () => {
        // Random service
        // const priceFeed = new RandomFeed();

        // Ccxt service
        const priceFeed = new CcxtFeed();
        await priceFeed.initialize();

        const service = new ExampleProviderService(priceFeed);
        return service;
      },
    },
  ],
})
export class RandomExampleProviderModule {}
