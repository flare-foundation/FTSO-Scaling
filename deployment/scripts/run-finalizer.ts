import { readFileSync } from "fs";
import { Web3Provider } from "../../src/providers/Web3Provider";
import { loadFTSOParameters } from "../config/FTSOParameters";
import { ContractAddresses, OUTPUT_FILE, loadAccounts } from "../tasks/common";
import { getLogger, setGlobalLogFile } from "../../src/utils/logger";
import { getWeb3 } from "../../src/utils/web3";
import { Finalizer } from "../../src/Finalizer";
import { EpochSettings } from "../../src/protocol/utils/EpochSettings";
import { BlockIndexer } from "../../src/BlockIndexer";

async function main() {
  const myId = +process.argv[2];
  if (!myId) throw Error("Must provide a finalizer id.");
  if (myId <= 0) throw Error("Finalizer id must be greater than 0.");

  setGlobalLogFile(`finalizer-${myId}`);

  const parameters = loadFTSOParameters();
  const web3 = getWeb3(parameters.rpcUrl.toString());

  const contractAddresses = loadContracts();
  getLogger("finalizer").info(`Initializing finalizer ${myId}, connecting to ${parameters.rpcUrl}`);

  let privateKey: string;
  if (process.env.FINALIZER_KEY != undefined) {
    privateKey = process.env.FINALIZER_KEY;
  } else {
    const accounts = loadAccounts(web3);
    privateKey = accounts[myId].privateKey;
  }

  const provider = await Web3Provider.create(contractAddresses, web3, parameters, privateKey);
  const indexer = new BlockIndexer(provider);
  const epochSettings = EpochSettings.fromProvider(provider);
  const finalizer = new Finalizer(provider, indexer, epochSettings);
  await finalizer.run();

  indexer.run();
}

function loadContracts(): ContractAddresses {
  const parsed = JSON.parse(readFileSync(OUTPUT_FILE).toString());
  if (Object.entries(parsed).length == 0) throw Error(`No contract addresses found in ${OUTPUT_FILE}`);
  return parsed;
}

main().catch(e => {
  console.error("Finalizer error, exiting", e);
  getLogger("finalizer").error(e);
  process.exit(1);
});
