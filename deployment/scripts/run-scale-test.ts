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

const DEFAULT_NUM_ACCOUNTS = 10;

// gov pub key: 0xc783df8a850f42e7f7e57013759c285caa701eb6
async function main() {
  let numAccounts = +process.argv[2];
  if (!numAccounts) numAccounts = DEFAULT_NUM_ACCOUNTS;

  const parameters = loadFTSOParameters();
  const web3 = getWeb3(parameters.rpcUrl.toString());

  const accounts: AccountDetails[] = JSON.parse(fs.readFileSync("coston2-100-accounts.json", "utf-8")).slice(
    0,
    numAccounts * 2
  );

  await fundAccounts(web3, accounts);
  console.log("Funded accounts.");
  await runProviders(numAccounts, accounts);

  while (true) {
    await sleepFor(10_000);
  }
}

async function fundAccounts(web3: Web3, accounts: AccountDetails[]) {
  const value = toBN(1);
  const weiValue = web3.utils.toWei(value);

  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!deployerKey) throw Error("No deployer private key found in env.");
  web3.eth.accounts.wallet.add(deployerKey);
  const deployerAddress = web3.eth.accounts.privateKeyToAccount(deployerKey!).address;

  let nonce = await web3.eth.getTransactionCount(deployerAddress);
  const sends: Promise<any>[] = [];
  for (const account of accounts) {
    const weiBalance = toBN(await web3.eth.getBalance(account.address));
    console.log(`Account balance: ${account.address} `, weiBalance.toString());
    if (weiBalance.lt(weiValue)) {
      const toSend = weiValue.sub(weiBalance);
      console.log(`Sending ${web3.utils.fromWei(toSend)} to ${account.address}`);
      // Set nonce manually, increment on each
      sends.push(
        web3.eth.sendTransaction({
          from: deployerAddress,
          to: account.address,
          value: toSend,
          gas: 30000,
          nonce: nonce++,
        })
      );
    }
  }
  await Promise.all(sends);
}

async function runProviders(numAccounts: number, accounts: AccountDetails[]) {
  for (let i = 0; i < numAccounts; i++) {
    const envConfig = {
      ...process.env,
      DATA_PROVIDER_VOTING_KEY: accounts[i * 2].privateKey,
      DATA_PROVIDER_CLAIM_KEY: accounts[i * 2 + 1].privateKey,
    };
    startDataProvider(i + 1, envConfig);
    await sleepFor(1000);
  }
}

function startDataProvider(id: number, envConfig: any): ChildProcess {
  const process = spawn("yarn", ["ts-node", "deployment/scripts/run-data-provider.ts", id.toString(), "random"], {
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
