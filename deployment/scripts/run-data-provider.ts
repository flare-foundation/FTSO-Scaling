import { readFileSync } from "fs";
import Web3 from "web3";
import { DataProvider } from "../../src/DataProvider";
import { FTSOClient } from "../../src/FTSOClient";
import { Web3Provider } from "../../src/providers/Web3Provider";
import { loadFTSOParameters } from "../config/FTSOParameters";
import { ContractAddresses, OUTPUT_FILE, generateRandomFeedsForClient, loadAccounts } from "../tasks/common";

function loadContracts(): ContractAddresses {
  const parsed = JSON.parse(readFileSync(OUTPUT_FILE).toString());
  if (Object.entries(parsed).length == 0) throw Error(`No contract addresses found in ${OUTPUT_FILE}`);
  return parsed;
}

async function main() {
  const myId = +process.argv[2];
  if (!myId) {
    throw Error("Must provide a data provider id.");
  }

  const web3 = new Web3("http://127.0.0.1:9650/ext/bc/C/rpc"); // TODO: move to config
  const accounts = loadAccounts(web3);
  const contractAddresses = loadContracts();
  const parameters = loadFTSOParameters();

  console.log(`Initializing data provider ${myId} with address ${accounts[myId].address}`);

  const provider = await Web3Provider.create(contractAddresses, web3, parameters, accounts[myId].privateKey);
  const client = new FTSOClient(provider);
  const feeds = generateRandomFeedsForClient(parameters.symbols);
  client.registerPriceFeeds(feeds);

  const dataProvider = new DataProvider(client, myId);
  await dataProvider.run();
}

main()