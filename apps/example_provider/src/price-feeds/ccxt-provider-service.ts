import { Logger } from "@nestjs/common";
import { Feed } from "../../../../libs/ftso-core/src/voting-types";
import { FeedPriceData } from "../dto/provider-requests.dto";
import ccxt, { Exchange, Trade } from "ccxt";
import { BaseDataFeed } from "./base-feed";

// TODO: Make configurable
const TRADE_HISTORY_WINDOW_MS = 60_000;
const DEFAULT_EXCHANGE = "binance";

export const CCXT_FALLBACK_PRICE = 1;

export class CcxtFeed implements BaseDataFeed {
  private readonly logger = new Logger(CcxtFeed.name);
  protected initialized = false;
  private client: Exchange;

  constructor() {}

  async initialize() {
    this.client = new (ccxt as any)[DEFAULT_EXCHANGE]();
    await this.client.loadMarkets();
    this.initialized = true;
  }

  async getPrice(feed: string): Promise<FeedPriceData> {
    if (!this.initialized) {
      await this.initialize();
    }
    let marketId;
    const feedSymbol = feedStringToPair(feed);
    console.log(feedSymbol);
    const symbol = `${feedSymbol.offerSymbol}/${feedSymbol.quoteSymbol}`;
    console.log(symbol);
    try {
      // for (const key in this.client.markets) {
      //   console.log(key);
      // }
      // console.dir(this.client.markets);
      
      marketId = this.client.markets[symbol].id;
    } catch (e) {
      this.logger.warn(`No market found for ${symbol} on ${DEFAULT_EXCHANGE}: ${e}`);
      return {
        feed,
        price: CCXT_FALLBACK_PRICE,
      };
    }
    let trades: Trade[];
    try {
      trades = await this.client.fetchTrades(marketId, Date.now() - TRADE_HISTORY_WINDOW_MS, 1);
    } catch (e) {
      this.logger.warn(`Failed to fetch trades for ${symbol} on ${DEFAULT_EXCHANGE}: ${e}`);
      return {
        feed,
        price: CCXT_FALLBACK_PRICE,
      };
    }
    if (trades.length === 0 || trades[0] === undefined) {
      this.logger.warn(`No trades found for ${symbol} on ${DEFAULT_EXCHANGE}`);
      return {
        feed,
        price: CCXT_FALLBACK_PRICE,
      };
    }

    return {
      feed,
      price: trades[0].price,
    };
  }

  async getPrices(feeds: string[]): Promise<FeedPriceData[]> {
    const promises = feeds.map(feed => this.getPrice(feed));
    return Promise.all(promises);
  }
}

// Helpers

function feedStringToPair(feed: string): { offerSymbol: string; quoteSymbol: string } {
  feed = unPrefix0x(feed);
  if (feed.length !== 16) {
    throw new Error(`Invalid feed string: ${feed}`);
  }

  const offerSymbol = fromHex(feed.substring(0, 8)).trim();
  const quoteSymbol = fromHex(feed.substring(8)).trim();
  return {
    offerSymbol,
    quoteSymbol,
  };
}

function unPrefix0x(tx: string) {
  if (!tx) {
    return "0x0";
  } else if (tx.startsWith("0x") || tx.startsWith("0X")) {
    return tx.slice(2);
  } else if (tx.startsWith("-0x") || tx.startsWith("-0X")) {
    return tx.slice(3);
  }
  return tx;
}

function fromHex(h) {
  var s = "";
  for (var i = 0; i < h.length; i += 2) {
    s += String.fromCharCode(parseInt(h.substr(i, 2), 16));
  }
  return decodeURIComponent(escape(s));
}
