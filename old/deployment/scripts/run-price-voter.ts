import { readFileSync } from "fs";
import { loadFTSOParameters, FTSOParameters } from "../../../apps/ftso-calculator/src/config/FTSOParameters";
import { setGlobalLogFile, getLogger } from "../../../apps/ftso-calculator/src/utils/logger";
import { getWeb3 } from "../../../apps/ftso-calculator/src/utils/web3";
import { IPriceProvider } from "../../../libs/ftso-core/src/IPriceFeed";
import { IndexerClient } from "../../../libs/ftso-core/src/IndexerClient";
import { ContractAddresses } from "../../../libs/ftso-core/src/utils/ContractAddresses";
import { EpochSettings } from "../../../libs/ftso-core/src/utils/EpochSettings";
import { Feed } from "../../../libs/ftso-core/src/voting-types";
import { FTSOClient } from "../../src/FTSOClient";
import { PriceVoter } from "../../src/PriceVoter";
import { Web3Provider } from "../../src/providers/Web3Provider";
import { createPriceFeedConfigs, RandomPriceFeed } from "../../test-utils/utils/RandomPriceFeed";
import { loadAccounts, getPriceFeeds, OUTPUT_FILE } from "../tasks/common";


async function main() {
  const myId = +process.argv[2];
  if (!myId) throw Error("Must provide a price voter id.");
  if (myId <= 0) throw Error("Price voter id must be greater than 0.");
  const useRandomFeed = process.argv[3] == "random";

  setGlobalLogFile(`price-voter-${myId}`);

  const parameters = loadFTSOParameters();
  const web3 = getWeb3(parameters.rpcUrl.toString());

  const contractAddresses = loadContracts();
  getLogger("price-voter").info(`Initializing price voter ${myId}, connecting to ${parameters.rpcUrl}`);

  let privateKey: string;
  if (process.env.VOTER_PRIVATE_KEY != undefined) {
    privateKey = process.env.VOTER_PRIVATE_KEY;
  } else {
    const accounts = loadAccounts(web3);
    privateKey = accounts[myId].privateKey;
  }

  const provider = await Web3Provider.create(contractAddresses, web3, parameters, privateKey);
  const epochSettings = EpochSettings.fromProvider(provider);
  const feeds = await getFeeds(useRandomFeed, parameters);
  const indexerClient = new IndexerClient(myId, epochSettings, contractAddresses);
  await indexerClient.initialize();

  const client = new FTSOClient(provider, indexerClient, epochSettings, feeds, getLogger(FTSOClient.name));
  const priceVoter = new PriceVoter(client, indexerClient, epochSettings);
  await priceVoter.run();
}

async function getFeeds(useRandomFeed: boolean, parameters: FTSOParameters) {
  let feeds: IPriceProvider[];
  if (useRandomFeed) {
    // Uses a fake randomised price feed.
    const symbols = parameters.feeds.map(x => x.symbol);
    feeds = createPriceFeedConfigs(symbols).map(config => new RandomPriceFeed(config));
  } else {
    // Uses a real price feed, with additional random noise.
    feeds = randomizeFeeds(await getPriceFeeds(parameters.feeds));
  }
  return feeds;
}

function loadContracts(): ContractAddresses {
  const parsed = JSON.parse(readFileSync(OUTPUT_FILE).toString());
  if (Object.entries(parsed).length == 0) throw Error(`No contract addresses found in ${OUTPUT_FILE}`);
  return parsed;
}

function randomizeFeeds(feeds: IPriceProvider[]): IPriceProvider[] {
  return feeds.map(feed => {
    return new (class implements IPriceProvider {
      getCurrentPrice(priceEpochId: number): number {
        const originalPrice = feed.getCurrentPrice(priceEpochId);
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

main().catch(e => {
  console.error("Price voter error, exiting", e);
  getLogger("price-voter").error(e);
  process.exit(1);
});
