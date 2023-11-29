import { readFileSync } from "fs";
import { loadFTSOParameters } from "../config/FTSOParameters";
import { OUTPUT_FILE } from "../tasks/common";
import { ContractAddresses } from "../../src/protocol/utils/ContractAddresses";
import { getLogger, setGlobalLogFile } from "../../src/utils/logger";
import { getWeb3 } from "../../src/utils/web3";
import { MockDBIndexer } from "../../src/MockDBIndexer";

async function main() {
  const myId = +process.argv[2];
  if (!myId) throw Error("Must provide a price voter id.");

  setGlobalLogFile(`indexer-${myId}`);

  const parameters = loadFTSOParameters();
  const web3 = getWeb3(parameters.rpcUrl.toString());

  const contractAddresses = loadContracts();
  getLogger("indexer").info(`Initializing indexer ${myId}, connecting to ${parameters.rpcUrl}`);

  const dbIndexer = new MockDBIndexer(web3, contractAddresses);
  dbIndexer.run();
}

function loadContracts(): ContractAddresses {
  const parsed = JSON.parse(readFileSync(OUTPUT_FILE).toString());
  if (Object.entries(parsed).length == 0) throw Error(`No contract addresses found in ${OUTPUT_FILE}`);
  return parsed;
}

main().catch(e => {
  console.error("Indexer error, exiting", e);
  getLogger("indexer").error(e);
  process.exit(1);
});
