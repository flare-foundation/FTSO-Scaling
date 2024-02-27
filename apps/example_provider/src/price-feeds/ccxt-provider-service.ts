import { Logger } from "@nestjs/common";
import { FeedPriceData } from "../dto/provider-requests.dto";
import ccxt, { Exchange, Ticker } from "ccxt";
import { BaseDataFeed } from "./base-feed";
import fs from "fs";
import { networks } from "../../../../libs/ftso-core/src/configs/networks";
import { retry } from "../../../../libs/ftso-core/src/utils/retry";

export const CCXT_FALLBACK_PRICE = 0.01;
const CONFIG_PREFIX = "apps/example_provider/src/config/";
const RETRY_BACKOFF_MS = 10_000;

interface FeedConfig {
  feed: string;
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
    const decodedFeed = decodeFeed(hexFeed);
    const price = await this.getFeedPrice(decodedFeed);
    return {
      feed: hexFeed,
      price: price !== undefined ? price : CCXT_FALLBACK_PRICE,
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

  private async getFeedPrice(decodedFeed: string): Promise<number> {
    const config = this.config.find(config => config.feed === decodedFeed);
    if (!config) {
      this.logger.warn(`No config found for ${decodedFeed}`);
      return undefined;
    }

    const prices: number[] = [];

    let usdtToUsd = undefined;

    for (const source of config.sources) {
      const info = this.prices.get(source.symbol)?.get(source.exchange);
      if (info === undefined) continue;

      if (source.symbol.endsWith("USDT")) {
        if (usdtToUsd === undefined) usdtToUsd = await this.getFeedPrice("USDT");
        prices.push(info.price * usdtToUsd);
      } else {
        prices.push(info.price);
      }
    }

    if (prices.length === 0) {
      this.logger.warn(`No prices found for ${decodedFeed}`);
      return this.getFallbackPrice(decodedFeed);
    }

    const result = prices.reduce((a, b) => a + b, 0) / prices.length;
    return result;
  }

  private async getFallbackPrice(decodedFeed: string): Promise<number> {
    const config = this.config.find(config => config.feed === decodedFeed);
    if (!config) {
      this.logger.warn(`No config found for ${decodedFeed}`);
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
          if (usdtToUsd === undefined) usdtToUsd = await this.getFeedPrice("USDT");
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

    this.logger.error(`No fallback price found for ${decodedFeed}`);
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
      const jsonString = fs.readFileSync(configPath, "utf-8");
      const config: FeedConfig[] = JSON.parse(jsonString);

      if (config.find(feed => feed.feed === "USDT") === undefined) {
        throw new Error("Must provide USDT feed sources, as it is used for USD conversion.");
      }

      return config;
    } catch (err) {
      this.logger.error("Error parsing JSON config:", err);
      throw err;
    }
  }
}

// Helpers

function decodeFeed(hexFeed: string): string {
  hexFeed = unPrefix0x(hexFeed);
  if (hexFeed.length !== 16) {
    throw new Error(`Invalid feed string: ${hexFeed}`);
  }

  return fromHex(hexFeed);
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

export function fromHex(hexString: string) {
  let decoded = "";
  for (let i = 0; i < hexString.length; i += 2) {
    const charCode = parseInt(hexString.substr(i, 2), 16);
    if (charCode === 0 || charCode > 112) {
      continue;
    } else {
      decoded += String.fromCharCode(charCode);
    }
  }
  return decodeURIComponent(decoded);
}
