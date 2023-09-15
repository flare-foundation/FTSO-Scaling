import { toBN } from "web3-utils";

import { getWeb3 } from "../../src/web3-utils";
import { loadFTSOParameters } from "../config/FTSOParameters";
import { sleepFor } from "../../src/time-utils";

import fs from "fs";
import Web3 from "web3";
import { ChildProcess, spawn } from "child_process";

interface AccountDetails {
  address: string;
  privateKey: string;
}

// gov pub key: 0xc783df8a850f42e7f7e57013759c285caa701eb6
async function main() {
  const parameters = loadFTSOParameters();
  const web3 = getWeb3(parameters.rpcUrl.toString());

  const accounts: AccountDetails[] = JSON.parse(fs.readFileSync("coston2-100-accounts.json", "utf-8")).slice(0, 10);

  await fundAccounts(web3, accounts);
  await runProviders(accounts);

  while (true) {
    await sleepFor(10_000);
  }
}

async function fundAccounts(web3: Web3, accounts: AccountDetails[]) {
  const value = toBN(1);
  const weiValue = web3.utils.toWei(value);

  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!deployerKey) throw Error("No deployer private key found in env.");
  const deployerAddress = web3.eth.accounts.privateKeyToAccount(deployerKey!).address;

  for (const account of accounts) {
    const weiBalance = toBN(await web3.eth.getBalance(account.address));
    if (weiBalance.lt(weiValue)) {
      const toSend = weiValue.sub(weiBalance);
      console.log(`Sending ${web3.utils.fromWei(toSend)} to ${account.address}`);
      await web3.eth.sendTransaction({
        from: deployerAddress,
        to: account.address,
        value: toSend,
      });
    }
  }
}

async function runProviders(accounts: AccountDetails[]) {
  for (let i = 0; i < accounts.length; i++) {
    const id = i + 1;
    const envConfig = {
      ...process.env,
      CHAIN_CONFIG: "local",
      DATA_PROVIDER_PRIVATE_KEY: accounts[i].privateKey,
    };
    startDataProvider(id, envConfig);
    await sleepFor(1000);
  }
}

function startDataProvider(id: number, envConfig: any): ChildProcess {
  const process = spawn("yarn", ["ts-node", "deployment/scripts/run-data-provider.ts", id.toString()], {
    env: envConfig,
  });
  process.stdout.on("data", function (data) {
    console.log(`[Provider ${id}]: ${data}`);
  });
  process.stderr.on("data", function (data) {
    console.log(`[Provider ${id}] ERROR: ${data}`);
  });
  process.on("close", function (code) {
    console.log("closing code: " + code);
    throw Error(`Provider ${id} exited with code ${code}`);
  });
  return process;
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
