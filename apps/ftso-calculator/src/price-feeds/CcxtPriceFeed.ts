import ccxt, { Exchange, NetworkError, RequestTimeout, Trade } from "ccxt";
import { IPriceProvider, PriceProviderImplFactory } from "../../../../libs/ftso-core/src/IPriceFeed";
import { Feed } from "../../../../libs/ftso-core/src/voting-types";
import { FeedConfig } from "../config/FTSOParameters";
import { getLogger } from "../utils/logger";

const UPDATE_INTERVAL_MS = 1_000;
/**
 * We only pick the last trade, but use a larger trade history window so that
 * we're more likely to get a first value on startup immediately.
 */
const TRADE_HISTORY_WINDOW_MS = 60_000;
const USDT_TO_USD = 1; // TODO: Get live value

// TODO: Make configurable
const DEFAULT_EXCHANGE = "binance";

/**
 * Price feed that uses CCXT to fetch prices from a single exchange.
 * Uses periodic polling to retrieve latest trades.
 */
export class CcxtPriceFeed implements IPriceProvider {
  private readonly logger = getLogger(CcxtPriceFeed.name);
  private readonly marketId: string;
  private lastPriceUSD: number = 0; // TODO: Avoid returning initial value 0
  private lastPriceTimestamp: number = 0;

  private constructor(readonly feed: Feed, private readonly client: Exchange) {
    const symbol = `${feed.offerSymbol}/${feed.quoteSymbol}`;
    try {
      this.marketId = client.markets[symbol].id;
    } catch (e) {
      throw new Error(`No market found for ${symbol}`);
    }
  }

  private async scheduleFetchTrades() {
    await this.fetchTrades();
    setTimeout(() => {
      this.scheduleFetchTrades();
    }, UPDATE_INTERVAL_MS);
  }

  private async fetchTrades() {
    let trades: Trade[];
    try {
      trades = await this.client.fetchTrades(this.marketId, Date.now() - TRADE_HISTORY_WINDOW_MS, 1);
    } catch (e) {
      if (e instanceof RequestTimeout) {
        this.logger.error(`Request timeout for ${this.feed.offerSymbol}/${this.feed.quoteSymbol}`);
        return;
      }
      if (e instanceof NetworkError) {
        this.logger.error(`Failed to fetch trades for ${this.feed.offerSymbol}/${this.feed.quoteSymbol}: NetworkError`);
        return;
      }
      throw e;
    }
    if (trades.length > 0) {
      const trade = trades[0]!;
      if (trade.timestamp > this.lastPriceTimestamp) {
        this.lastPriceUSD = trade.price * USDT_TO_USD;
        this.lastPriceTimestamp = trade.timestamp;
      }
    }
  }

  getCurrentPrice(): number {
    return this.lastPriceUSD;
  }

  @PriceProviderImplFactory
  static async create(config: FeedConfig): Promise<CcxtPriceFeed> {
    const client: Exchange = new (ccxt as any)[DEFAULT_EXCHANGE]();
    await client.loadMarkets();
    const priceFeed = new CcxtPriceFeed(config.symbol, client);
    await priceFeed.scheduleFetchTrades();
    priceFeed.logger.info(`Created price feed for symbol ${config.symbol.offerSymbol}/${config.symbol.quoteSymbol}`);
    return priceFeed;
  }
}
