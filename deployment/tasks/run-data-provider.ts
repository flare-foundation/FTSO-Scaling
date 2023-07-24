import { readFileSync } from "fs";
import { sleepFor } from "../../src/time-utils";
import { FTSOClient } from "../../src/FTSOClient";
import { DataProvider } from "../../src/DataProvider";

import { TruffleProvider } from "../../src/providers/TruffleProvider";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { OUTPUT_FILE, generateRandomFeedsForClient, loadAccounts } from "./common";
import { FTSOParameters } from "../config/FTSOParameters";

function loadContracts() {
  return JSON.parse(readFileSync(OUTPUT_FILE).toString());
}
export async function runDataProvider(hre: HardhatRuntimeEnvironment, myId: number, parameters: FTSOParameters) {
  console.log(`Starting data provider ${myId}`);

  const accounts = loadAccounts();
  const contractAddresses = loadContracts();

  console.log(`Initializing data provider ${myId} with address ${accounts[myId].address}`);

  const provider = new TruffleProvider(
    contractAddresses.voting,
    contractAddresses.votingRewardManager,
    contractAddresses.voterRegistry,
    contractAddresses.priceOracle,
    contractAddresses.votingManager
  );
  provider.web3 = hre.web3;
  provider.artifacts = hre.artifacts;
  await provider.initialize({ privateKey: accounts[myId].privateKey });
  const client = new FTSOClient(provider);

  const feeds = generateRandomFeedsForClient(parameters.symbols);
  console.log(JSON.stringify(feeds));
  client.registerPriceFeeds(feeds);

  const dataProvider = new DataProvider(client, myId);
  dataProvider.run();

  while (true) {
    await sleepFor(10_000);
  }
}
