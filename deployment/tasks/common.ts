import { RandomPriceFeedConfig, RandomPriceFeed } from "../../src/price-feeds/RandomPriceFeed";
import { Feed } from "../../src/voting-interfaces";
import { readFileSync } from "fs";
import Web3 from "web3";

export interface ContractAddresses {
  votingManager: string;
  voterRegistry: string;
  voting: string;
  votingRewardManager: string;
  priceOracle: string;
}

export const OUTPUT_FILE = "./deployed-contracts.json";
export const TEST_ACCOUNT_FILE = "./deployment/config/test-1020-accounts.json";

export function generateRandomFeedsForClient(symbols: Feed[]) {
  const priceFeedConfigs: RandomPriceFeedConfig[] = [];
  for (let j = 0; j < symbols.length; j++) {
    const priceFeedConfig = {
      period: 10,
      factor: 1000 * (j + 1),
      variance: 100,
      feedInfo: symbols[j],
    } as RandomPriceFeedConfig;
    priceFeedConfigs.push(priceFeedConfig);
  }
  return priceFeedConfigs.map(config => new RandomPriceFeed(config));
}

export function loadAccounts(web3: Web3) {
  return JSON.parse(readFileSync(TEST_ACCOUNT_FILE).toString()).map((x: any) =>
    web3.eth.accounts.privateKeyToAccount(x.privateKey)
  );
}
