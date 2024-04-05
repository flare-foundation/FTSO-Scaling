import { expect } from "chai";
import { ExampleProviderService } from "../../../apps/example_provider/src/example-provider-service";
import { ExampleProviderController } from "../../../apps/example_provider/src/example-provider.controller";
import { CcxtFeed } from "../../../apps/example_provider/src/data-feeds/ccxt-provider-service";
import { RandomFeed } from "../../../apps/example_provider/src/data-feeds/random-feed";
import { sleepFor } from "../../../libs/ftso-core/src/utils/retry";
import { FeedId } from "../../../apps/example_provider/src/dto/provider-requests.dto";

export const DEFAULT_VALUE = 0.01;
const BTC_USD: FeedId = { category: 1, name: "4254430000000000" };

describe("ExampleProviderController Random", () => {
  let exampleProviderController: ExampleProviderController;

  beforeEach(async () => {
    const dataFeed = new RandomFeed();
    const service = new ExampleProviderService(dataFeed);
    exampleProviderController = new ExampleProviderController(service);
  });

  describe("Example Random provider test ", () => {
    it('return the voting round id that was provided"', async () => {
      const feedRes = await exampleProviderController.getFeedValue(123, BTC_USD);
      expect(feedRes.votingRoundId).to.be.equal(123);
    });
  });
});

// Ignoring for now as querying binance fails in CI
// "ExchangeNotAvailable: binance GET https://api.binance.com/api/v3/exchangeInfo 451"
describe.skip("ExampleProviderController CCXT", () => {
  let exampleProviderController: ExampleProviderController;

  beforeEach(async () => {
    const dataFeed = new CcxtFeed();
    await dataFeed.start();
    const service = new ExampleProviderService(dataFeed);
    exampleProviderController = new ExampleProviderController(service);

    // Need to wait for trades to populate
    await sleepFor(5_000);
  });

  describe("Example CCXT provider test ", () => {
    it('return the voting round id that was provided"', async () => {
      const feedRes = await exampleProviderController.getFeedValue(123, BTC_USD);
      expect(feedRes.votingRoundId).to.be.equal(123);
    });

    it("should get BTC USD price", async () => {
      const feedRes = await exampleProviderController.getFeedValue(123, BTC_USD);
      expect(feedRes.votingRoundId).to.be.equal(123);
      expect(feedRes.data.value).to.be.greaterThan(0);
      expect(feedRes.data.feed).to.be.equal(BTC_USD);
      expect(feedRes.data.value).not.to.be.equal(DEFAULT_VALUE);
    });

    it.skip("should return all coston prices", async () => {
      const feeds = [
        "FLR",
        "SGB",
        "XRP",
        "LTC",
        "XLM",
        "DOGE",
        "ADA",
        "ALGO",
        "BTC",
        "ETH",
        "FIL",
        "ARB",
        "AVAX",
        "BNB",
        "MATIC",
        "SOL",
        "USDC",
        "USDT",
        "XDC",
        "TRX",
        "DOT",
        "LINK",
        "TON",
        "ICP",
        "SHIB",
        "DAI",
        "BCH",
        "ATOM",
        "UNI",
        "LEO",
        "ETC",
        "INJ",
        "EUR",
      ];
      const feedIds: FeedId[] = feeds.map(feed => {
        return { category: 1, name: `${feed}/USD` };
      });

      await sleepFor(40_000);

      const bulkRes = await exampleProviderController.getFeedValues(123, { feeds: feedIds });
      for (const [i, price] of bulkRes.data.entries()) {
        console.log(`Feed ${feeds[i]} price: ${price.value}`);
      }
    });
  });
});
