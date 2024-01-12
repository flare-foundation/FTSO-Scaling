import { Test, TestingModule } from "@nestjs/testing";
import { ExampleProviderService } from "../src/example-provider-service";
import { ExampleProviderController } from "../src/example-provider.controller";
import { CCXT_FALLBACK_PRICE, CcxtFeed } from "../src/price-feeds/ccxt-provider-service";
import e from "express";
import { RandomFeed } from "../src/price-feeds/random-feed";

describe("ExampleProviderController Random", () => {
  let exampleProviderController: ExampleProviderController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [ExampleProviderController],
      providers: [
        {
          provide: "EXAMPLE_PROVIDER_SERVICE",
          useFactory: async () => {
            const priceFeed = new RandomFeed();
            const service = new ExampleProviderService(priceFeed);
            return service;
          },
        },
      ],
    }).compile();

    exampleProviderController = app.get<ExampleProviderController>(ExampleProviderController);
  });

  describe("Example Random provider test ", () => {
    it('return the voting round id that was provided"', async () => {
      const feedRes = await exampleProviderController.getPriceFeed(123, "BTC-USD");
      expect(feedRes.votingRoundId).toBe(123);
    });
  });
});

describe("ExampleProviderController CCXT", () => {
  let exampleProviderController: ExampleProviderController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [ExampleProviderController],
      providers: [
        {
          provide: "EXAMPLE_PROVIDER_SERVICE",
          useFactory: async () => {
            // Ccxt service
            const priceFeed = new CcxtFeed();
            await priceFeed.initialize();
            const service = new ExampleProviderService(priceFeed);
            return service;
          },
        },
      ],
    }).compile();

    exampleProviderController = app.get<ExampleProviderController>(ExampleProviderController);
  });

  describe("Example CCXT provider test ", () => {
    it('return the voting round id that was provided"', async () => {
      const feedRes = await exampleProviderController.getPriceFeed(123, "BTC-USD");
      expect(feedRes.votingRoundId).toBe(123);
    });

    it("should get BTC USDT price", async () => {
      const BTC_USDT = "0x4254432055534454";
      const feedRes = await exampleProviderController.getPriceFeed(123, BTC_USDT);
      expect(feedRes.votingRoundId).toBe(123);
      expect(feedRes.feedPriceData.price).toBeGreaterThan(0);
      expect(feedRes.feedPriceData.feed).toBe(BTC_USDT);
      expect(feedRes.feedPriceData.price).not.toEqual(CCXT_FALLBACK_PRICE);
    });
  });
});
