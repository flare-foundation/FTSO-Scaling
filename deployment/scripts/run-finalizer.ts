import { readFileSync } from "fs";
import { FTSOClient } from "../../src/FTSOClient";
import { Web3Provider } from "../../src/providers/Web3Provider";
import { loadFTSOParameters } from "../config/FTSOParameters";
import { ContractAddresses, OUTPUT_FILE, loadAccounts } from "../tasks/common";
import { getLogger, setGlobalLogFile } from "../../src/utils/logger";
import { getWeb3 } from "../../src/utils/web3";
import { Finalizer } from "../../src/Finalizer";

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
    privateKey = accounts[myId * 2 - 1].privateKey;
  }

  const provider = await Web3Provider.create(contractAddresses, web3, parameters, privateKey, privateKey);
  const client = new FTSOClient(provider, await provider.getBlockNumber());

  const finalizer = new Finalizer(client);
  await finalizer.run();
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
