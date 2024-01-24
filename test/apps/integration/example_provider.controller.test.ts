import { expect } from "chai";
import { ExampleProviderService } from "../../../apps/example_provider/src/example-provider-service";
import { ExampleProviderController } from "../../../apps/example_provider/src/example-provider.controller";
import { CcxtFeed, CCXT_FALLBACK_PRICE } from "../../../apps/example_provider/src/price-feeds/ccxt-provider-service";
import { RandomFeed } from "../../../apps/example_provider/src/price-feeds/random-feed";

const BTC_USDT = "4254430055534454";

describe("ExampleProviderController Random", () => {
  let exampleProviderController: ExampleProviderController;

  beforeEach(async () => {
    const priceFeed = new RandomFeed();
    const service = new ExampleProviderService(priceFeed);
    exampleProviderController = new ExampleProviderController(service);
  });

  describe("Example Random provider test ", () => {
    it('return the voting round id that was provided"', async () => {
      const feedRes = await exampleProviderController.getPriceFeed(123, BTC_USDT);
      expect(feedRes.votingRoundId).to.be.equal(123);
    });
  });
});

// Ignoring for now as querying binance fails in CI
// "ExchangeNotAvailable: binance GET https://api.binance.com/api/v3/exchangeInfo 451"
describe.skip("ExampleProviderController CCXT", () => {
  let exampleProviderController: ExampleProviderController;

  beforeEach(async () => {
    const priceFeed = new CcxtFeed();
    await priceFeed.initialize();
    const service = new ExampleProviderService(priceFeed);
    exampleProviderController = new ExampleProviderController(service);
  });

  describe("Example CCXT provider test ", () => {
    it('return the voting round id that was provided"', async () => {
      const feedRes = await exampleProviderController.getPriceFeed(123, BTC_USDT);
      expect(feedRes.votingRoundId).to.be.equal(123);
    });

    it("should get BTC USDT price", async () => {
      const feedRes = await exampleProviderController.getPriceFeed(123, BTC_USDT);
      expect(feedRes.votingRoundId).to.be.equal(123);
      expect(feedRes.feedPriceData.price).to.be.greaterThan(0);
      expect(feedRes.feedPriceData.feed).to.be.equal(BTC_USDT);
      expect(feedRes.feedPriceData.price).not.to.be.equal(CCXT_FALLBACK_PRICE);
    });
  });
});
