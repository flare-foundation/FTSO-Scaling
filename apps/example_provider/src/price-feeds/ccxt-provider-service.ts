import { Logger } from "@nestjs/common";
import ccxt, { Exchange, Ticker } from "ccxt";
import { readFileSync } from "fs";
import { networks } from "../../../../libs/ftso-core/src/configs/networks";
import { retry } from "../../../../libs/ftso-core/src/utils/retry";
import { FeedPriceData } from "../dto/provider-requests.dto";
import { BaseDataFeed } from "./base-feed";
import { FeedType } from "../../../../libs/ftso-core/src/voting-types";

export const CCXT_FALLBACK_PRICE = 0.01;
const CONFIG_PREFIX = "apps/example_provider/src/config/";
const RETRY_BACKOFF_MS = 10_000;

export class FeedId {
  constructor(readonly type: FeedType, readonly name: string) {}

  toHex(): string {
    const typeHex = this.type.valueOf().toString(16).padStart(2, "0");
    const nameBuf = Buffer.from(this.name, "utf8");
    return typeHex + nameBuf.toString("hex").padEnd(40, "0");
  }

  toString(): string {
    return `(${this.type} ${this.name})`;
  }

  equals(other: FeedId): boolean {
    return this.type === other.type && this.name === other.name;
  }

  static fromHex(hex: string): FeedId {
    return decodeFeed(hex);
  }
}

interface FeedConfig {
  feed: FeedId;
  sources: {
    exchange: string;
    symbol: string;
  }[];
}

interface PriceInfo {
  price: number;
  time: number;
  exchange: string;
}

const usdtToUsdFeedId = new FeedId(FeedType.Crypto, "USDT/USD");
export class CcxtFeed implements BaseDataFeed {
  private readonly logger = new Logger(CcxtFeed.name);
  protected initialized = false;
  private config: FeedConfig[];

  private readonly exchangeByName: Map<string, Exchange> = new Map();

  /** Symbol -> exchange -> price */
  private readonly prices: Map<string, Map<string, PriceInfo>> = new Map();

  async start() {
    this.config = this.loadConfig();
    const exchangeToSymbols = new Map<string, Set<string>>();

    for (const feed of this.config) {
      for (const source of feed.sources) {
        const symbols = exchangeToSymbols.get(source.exchange) || new Set();
        symbols.add(source.symbol);
        exchangeToSymbols.set(source.exchange, symbols);
      }
    }

    const loadExchanges = [];
    for (const exchangeName of exchangeToSymbols.keys()) {
      try {
        const exchange: Exchange = new ccxt.pro[exchangeName]({ newUpdates: true });
        this.exchangeByName.set(exchangeName, exchange);
        loadExchanges.push(retry(async () => exchange.loadMarkets(), RETRY_BACKOFF_MS));
      } catch (e) {
        this.logger.warn(`Failed to load markets for ${exchangeName}: ${e}`);
      }
    }
    await Promise.all(loadExchanges);
    this.initialized = true;

    void this.watchTrades(exchangeToSymbols);
  }

  async getPrices(hexFeeds: string[]): Promise<FeedPriceData[]> {
    const promises = hexFeeds.map(feed => this.getPrice(feed));
    return Promise.all(promises);
  }

  async getPrice(hexFeed: string): Promise<FeedPriceData> {
    const decodedFeed = FeedId.fromHex(hexFeed);
    const price = await this.getFeedPrice(decodedFeed);
    return {
      feed: hexFeed,
      price: price,
    };
  }

  private async watchTrades(exchangeToSymbols: Map<string, Set<string>>) {
    for (const [exchangeName, symbols] of exchangeToSymbols) {
      const exchange = this.exchangeByName.get(exchangeName);
      if (exchange === undefined) continue;

      const symbolArray = Array.from(symbols);
      const marketIds = symbolArray.map(symbol => exchange.markets[symbol].id);
      void this.watch(exchange, marketIds, exchangeName);
    }
  }

  private async watch(exchange: Exchange, marketIds: string[], exchangeName: string) {
    this.logger.log(`Watching trades for ${marketIds} on exchange ${exchangeName}`);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const trades = await retry(async () => exchange.watchTradesForSymbols(marketIds, null, 100), RETRY_BACKOFF_MS);
        trades.forEach(trade => {
          const prices = this.prices.get(trade.symbol) || new Map<string, PriceInfo>();
          prices.set(exchangeName, { price: trade.price, time: trade.timestamp, exchange: exchangeName });
          this.prices.set(trade.symbol, prices);
        });
      } catch (e) {
        this.logger.error(`Failed to watch trades for ${exchangeName}: ${e}`);
        return;
      }
    }
  }

  private async getFeedPrice(feedId: FeedId): Promise<number> {
    const config = this.config.find(config => config.feed.equals(feedId));
    if (!config) {
      this.logger.warn(`No config found for ${feedId}`);
      return undefined;
    }

    const prices: number[] = [];

    let usdtToUsd = undefined;

    for (const source of config.sources) {
      const info = this.prices.get(source.symbol)?.get(source.exchange);
      if (info === undefined) continue;

      if (source.symbol.endsWith("USDT")) {
        if (usdtToUsd === undefined) usdtToUsd = await this.getFeedPrice(usdtToUsdFeedId);
        prices.push(info.price * usdtToUsd);
      } else {
        prices.push(info.price);
      }
    }

    if (prices.length === 0) {
      this.logger.warn(`No prices found for ${feedId}`);
      return this.getFallbackPrice(usdtToUsdFeedId);
    }

    const result = prices.reduce((a, b) => a + b, 0) / prices.length;
    return result;
  }

  private async getFallbackPrice(feedId: FeedId): Promise<number> {
    const config = this.config.find(config => config.feed.equals(feedId));
    if (!config) {
      this.logger.warn(`No config found for ${feedId}`);
      return undefined;
    }

    let usdtToUsd = undefined;

    for (const source of config.sources) {
      const exchange = this.exchangeByName.get(source.exchange);
      if (exchange === undefined) continue;
      const symbol = source.symbol;
      let ticker: Ticker;
      try {
        ticker = await retry(async () => await exchange.fetchTicker(symbol), RETRY_BACKOFF_MS);
        let price;
        if (source.symbol.endsWith("USDT")) {
          if (usdtToUsd === undefined) usdtToUsd = await this.getFeedPrice(usdtToUsd);
          price = ticker.last * usdtToUsd;
        } else {
          price = ticker.last;
        }
        const priceForSymbol = this.prices.get(source.symbol) || new Map<string, PriceInfo>();
        priceForSymbol.set(source.exchange, { price: price, time: 0, exchange: source.exchange });
        this.prices.set(source.symbol, priceForSymbol);
        return price;
      } catch (e) {
        this.logger.error(`Failed to fetch ticker for ${symbol} on ${source.exchange}: ${e}`);
      }
    }

    this.logger.error(`No fallback price found for ${feedId}`);
    return undefined;
  }

  private loadConfig() {
    const network = process.env.NETWORK as networks;
    let configPath: string;
    switch (network) {
      case "local-test":
        configPath = CONFIG_PREFIX + "coston.json";
        break;
      case "coston2":
        configPath = CONFIG_PREFIX + "coston.json";
        break;
      default:
        // TODO: Add support for from-env?
        configPath = CONFIG_PREFIX + "coston.json";
    }

    try {
      const jsonString = readFileSync(configPath, "utf-8");
      const config: FeedConfig[] = JSON.parse(jsonString, (key, value) => {
        if (key === "feed") {
          return new FeedId(value.type, value.name);
        }
        return value;
      });

      if (config.find(feed => feed.feed.equals(usdtToUsdFeedId)) === undefined) {
        throw new Error("Must provide USDT feed sources, as it is used for USD conversion.");
      }

      config.forEach(feed => {
        console.log(feed.feed.toHex());
      });

      return config;
    } catch (err) {
      this.logger.error("Error parsing JSON config:", err);
      throw err;
    }
  }
}

// Helpers

export function decodeFeed(feedIdHex: string): FeedId {
  feedIdHex = unPrefix0x(feedIdHex);
  if (feedIdHex.length !== 42) {
    throw new Error(`Invalid feed string: ${feedIdHex}`);
  }

  const type = parseInt(feedIdHex.slice(0, 2));
  const feedType = FeedType[FeedType[type] as keyof typeof FeedType];

  const nameBuf = Buffer.from(feedIdHex.slice(2), "hex");
  return new FeedId(feedType, nameBuf.toString("utf8").replaceAll("\0", ""));
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
