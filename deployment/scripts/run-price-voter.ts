import { readFileSync } from "fs";
import { FTSOClient } from "../../src/FTSOClient";
import { Web3Provider } from "../../src/providers/Web3Provider";
import { loadFTSOParameters } from "../config/FTSOParameters";
import { ContractAddresses, OUTPUT_FILE, getPriceFeeds, loadAccounts } from "../tasks/common";
import { IPriceFeed } from "../../src/price-feeds/IPriceFeed";
import { Feed } from "../../src/protocol/voting-types";
import { getLogger, setGlobalLogFile } from "../../src/utils/logger";
import { getWeb3 } from "../../src/utils/web3";
import { RandomPriceFeed, createPriceFeedConfigs } from "../../test-utils/utils/RandomPriceFeed";
import { PriceVoter } from "../../src/PriceVoter";

async function main() {
  const myId = +process.argv[2];
  if (!myId) throw Error("Must provide a data provider id.");
  if (myId <= 0) throw Error("Data provider id must be greater than 0.");
  const useRandomFeed = process.argv[3] == "random";

  setGlobalLogFile(`price-voter-${myId}`);

  const parameters = loadFTSOParameters();
  const web3 = getWeb3(parameters.rpcUrl.toString());

  const contractAddresses = loadContracts();
  getLogger("price-voter").info(`Initializing data provider ${myId}, connecting to ${parameters.rpcUrl}`);

  let votingKey: string;
  let claimKey: string;
  if (process.env.DATA_PROVIDER_VOTING_KEY != undefined && process.env.DATA_PROVIDER_CLAIM_KEY != undefined) {
    votingKey = process.env.DATA_PROVIDER_VOTING_KEY;
    claimKey = process.env.DATA_PROVIDER_CLAIM_KEY;
  } else {
    const accounts = loadAccounts(web3);
    votingKey = accounts[myId * 2 - 1].privateKey;
    claimKey = accounts[myId * 2].privateKey;
  }

  const provider = await Web3Provider.create(contractAddresses, web3, parameters, votingKey, claimKey);
  const client = new FTSOClient(provider, await provider.getBlockNumber());
  let feeds: IPriceFeed[];
  if (useRandomFeed) {
    // Uses a fake randomised price feed.
    feeds = createPriceFeedConfigs(parameters.symbols).map(config => new RandomPriceFeed(config));
  } else {
    // Uses a real price feed, with additional random noise.
    feeds = randomizeFeeds(await getPriceFeeds(parameters.symbols));
  }
  client.registerPriceFeeds(feeds);

  const priceVoter = new PriceVoter(client);
  await priceVoter.run();
}

function loadContracts(): ContractAddresses {
  const parsed = JSON.parse(readFileSync(OUTPUT_FILE).toString());
  if (Object.entries(parsed).length == 0) throw Error(`No contract addresses found in ${OUTPUT_FILE}`);
  return parsed;
}

function randomizeFeeds(feeds: IPriceFeed[]): IPriceFeed[] {
  return feeds.map(feed => {
    return new (class implements IPriceFeed {
      getPriceForEpoch(priceEpochId: number): number {
        const originalPrice = feed.getPriceForEpoch(priceEpochId);
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
