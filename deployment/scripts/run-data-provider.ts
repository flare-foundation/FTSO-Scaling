import { readFileSync } from "fs";
import Web3 from "web3";
import { DataProvider } from "../../src/DataProvider";
import { FTSOClient } from "../../src/FTSOClient";
import { Web3Provider } from "../../src/providers/Web3Provider";
import { loadFTSOParameters } from "../config/FTSOParameters";
import { ContractAddresses, OUTPUT_FILE, getPriceFeeds, loadAccounts } from "../tasks/common";
import { IPriceFeed } from "../../src/price-feeds/IPriceFeed";
import { Feed } from "../../src/voting-interfaces";
import { getLogger, setGlobalLogFile } from "../../src/utils/logger";

async function main() {
  const myId = +process.argv[2];
  if (!myId) {
    throw Error("Must provide a data provider id.");
  }

  setGlobalLogFile(`data-provider-${myId}`);

  const parameters = loadFTSOParameters();
  const httpProvider = new Web3.providers.HttpProvider(parameters.rpcUrl.toString());
  const web3 = new Web3(httpProvider);

  const accounts = loadAccounts(web3);
  const contractAddresses = loadContracts();

  getLogger("data-provider").info(`Initializing data provider ${myId} with address ${accounts[myId].address}`);

  const provider = await Web3Provider.create(contractAddresses, web3, parameters, accounts[myId].privateKey);
  const client = new FTSOClient(provider);
  const feeds = await getPriceFeeds(parameters.symbols);
  client.registerPriceFeeds(randomizeFeeds(feeds));

  const dataProvider = new DataProvider(client, myId);
  await dataProvider.run();
}

function loadContracts(): ContractAddresses {
  const parsed = JSON.parse(readFileSync(OUTPUT_FILE).toString());
  if (Object.entries(parsed).length == 0) throw Error(`No contract addresses found in ${OUTPUT_FILE}`);
  return parsed;
}

function randomizeFeeds(feeds: IPriceFeed[]): IPriceFeed[] {
  return feeds.map(feed => {
    return new (class implements IPriceFeed {
      getPriceForEpoch(epochId: number): number {
        const originalPrice = feed.getPriceForEpoch(epochId);
        return addNoise(originalPrice);
      }
      getFeedInfo(): Feed {
        return feed.getFeedInfo();
      }
    })();
  });
}

function addNoise(num: number): number {
  const noise = num * 0.001 * Math.random();
  const sign = Math.random() < 0.5 ? -1 : 1;
  return num + noise * sign;
}

main();
