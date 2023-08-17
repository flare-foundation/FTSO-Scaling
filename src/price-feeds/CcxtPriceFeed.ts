import { Exchange, binance, binanceus } from "ccxt";
import { IPriceFeed } from "./IPriceFeed";
import { Feed } from "../voting-interfaces";

const UPDATE_INTERVAL_MS = 1_000;
const USDT_TO_USD = 1; // TODO: Get live value

/**
 * Price feed that uses CCXT to fetch prices from a single exchange.
 * Uses periodic polling to retrieve latest trades.
 */
export class CcxtPriceFeed implements IPriceFeed {
  private readonly marketId: string;
  private lastPriceUSD: number = 0; // TODO: Avoid returning initial value 0
  private lastPriceTimestamp: number = 0;

  constructor(private readonly feed: Feed, private readonly client: Exchange) {
    const symbol = `${feed.offerSymbol}/${feed.quoteSymbol}`;
    try {
      this.marketId = client.markets[symbol].id;
    } catch (e) {
      throw new Error(`No market found for ${symbol}`);
    }
    this.scheduleFetchTrades();
  }

  private scheduleFetchTrades() {
    this.client.fetchTrades(this.marketId, Date.now() - UPDATE_INTERVAL_MS, 1).then(trades => {
      if (trades.length > 0) {
        const trade = trades[0]!;
        if (trade.timestamp > this.lastPriceTimestamp) {
          this.lastPriceUSD = trade.price * USDT_TO_USD;
          this.lastPriceTimestamp = trade.timestamp;
        }
      }
      setTimeout(() => {
        this.scheduleFetchTrades();
      }, UPDATE_INTERVAL_MS);
    });
  }

  getPriceForEpoch(epochId: number): number {
    return this.lastPriceUSD;
  }
  getFeedInfo(): Feed {
    return this.feed;
  }
}
