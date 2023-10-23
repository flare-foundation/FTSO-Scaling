import { Feed } from "../../src/protocol/voting-types";
import { readFileSync } from "fs";
import { Account } from "web3-core";

import Web3 from "web3";
import ccxt, { Exchange } from "ccxt";
import { CcxtPriceFeed } from "../../src/price-feeds/CcxtPriceFeed";

export interface ContractAddresses {
  votingManager: string;
  voterRegistry: string;
  voting: string;
  votingRewardManager: string;
  priceOracle: string;
}

export const OUTPUT_FILE = "./deployed-contracts.json";
export const TEST_ACCOUNT_FILE = "./deployment/config/test-1020-accounts.json";
const DEFAULT_EXCHANGE = "binance";

export async function getPriceFeeds(symbols: Feed[], exchange: string = DEFAULT_EXCHANGE) {
  const client: Exchange = new (ccxt as any)[exchange]();
  await client.loadMarkets();
  return Promise.all(symbols.map(async symbol => await CcxtPriceFeed.create(symbol, client)));
}

export function loadAccounts(web3: Web3): Account[] {
  return JSON.parse(readFileSync(TEST_ACCOUNT_FILE).toString()).map((x: any) =>
    web3.eth.accounts.privateKeyToAccount(x.privateKey)
  );
}
