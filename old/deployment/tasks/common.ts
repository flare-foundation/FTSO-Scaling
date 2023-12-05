import { readFileSync } from "fs";
import { Account } from "web3-core";
import "../../src/price-feeds/CcxtPriceFeed";

import Web3 from "web3";
import { FeedConfig } from "../../../apps/ftso-calculator/src/config/FTSOParameters";
import { priceProviderImplRegistry, IPriceProvider } from "../../../libs/ftso-core/src/IPriceFeed";

export const OUTPUT_FILE = "./deployed-contracts.json";
export const TEST_ACCOUNT_FILE = "./deployment/config/test-1020-accounts.json";

export async function getPriceFeeds(feedConfigs: FeedConfig[]) {
  return Promise.all(
    feedConfigs.map(async config => {
      const factory = priceProviderImplRegistry.get(config.providerImpl)!;
      const provider: IPriceProvider = await factory.call(factory, config);
      return provider;
    })
  );
}

export function loadAccounts(web3: Web3): Account[] {
  return JSON.parse(readFileSync(TEST_ACCOUNT_FILE).toString()).map((x: any) =>
    web3.eth.accounts.privateKeyToAccount(x.privateKey)
  );
}
