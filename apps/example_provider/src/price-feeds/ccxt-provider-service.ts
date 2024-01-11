import { Logger } from "@nestjs/common";
import { Feed } from "../../../../libs/ftso-core/src/voting-types";
import { FeedPriceData } from "../dto/provider-requests.dto";
import ccxt, { Exchange, Trade } from "ccxt";
import { BaseDataFeed } from "./base-feed";

// TODO: Make configurable
const TRADE_HISTORY_WINDOW_MS = 60_000;
const DEFAULT_EXCHANGE = "binance";

const FALLBACK_PRICE = 1;

export class CcxtFeed implements BaseDataFeed  {
  private readonly logger = new Logger(CcxtFeed.name);
  protected initialized = false;
  private client: Exchange;

  constructor() {}

  async initialize() {
    this.client = new (ccxt as any)[DEFAULT_EXCHANGE]();
    await this.client.loadMarkets();
    this.initialized = true;
  }

  async getPrice(feed: Feed): Promise<FeedPriceData> {
    if (!this.initialized) {
      await this.initialize();
    }
    let marketId;
    const symbol = `${feed.offerSymbol}/${feed.quoteSymbol}`;
    try {
      // for (const key in this.client.markets) {
      //   console.log(key);
      // }
      // console.dir(this.client.markets);
      marketId = this.client.markets[symbol].id;
    } catch (e) {
      this.logger.error(`No market found for ${symbol} on ${DEFAULT_EXCHANGE}: ${e}`);
      return {
        feed,
        price: FALLBACK_PRICE,
      };
    }
    let trades: Trade[];
    try {
      trades = await this.client.fetchTrades(marketId, Date.now() - TRADE_HISTORY_WINDOW_MS, 1);
    } catch (e) {
      this.logger.error(`Failed to fetch trades for ${symbol} on ${DEFAULT_EXCHANGE}: ${e}`);
      return {
        feed,
        price: FALLBACK_PRICE,
      };
    }
    if (trades.length === 0 || trades[0] === undefined) {
      this.logger.error(`No trades found for ${symbol} on ${DEFAULT_EXCHANGE}`);
      return {
        feed,
        price: FALLBACK_PRICE,
      };
    }

    return {
      feed,
      price: trades[0].price,
    };
  }

  async getPrices(feeds: Feed[]): Promise<FeedPriceData[]> {
    const promises = feeds.map(feed => this.getPrice(feed));
    return Promise.all(promises);
  }
}
