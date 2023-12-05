import { toBN } from "web3-utils";

import { getWeb3 } from "../../src/utils/web3";
import { loadFTSOParameters } from "../../../apps/ftso-calculator/src/config/FTSOParameters";
import { sleepFor } from "../../src/utils/time";

import fs from "fs";
import Web3 from "web3";
import { ChildProcess, spawn } from "child_process";

interface AccountDetails {
  address: string;
  privateKey: string;
}

const DEFAULT_VOTER_COUNT = 3;
const DEFAULT_FINALIZER_COUNT = 2;
const DEFAULT_BATCH_ID = 0;

// gov pub key: 0xc783df8a850f42e7f7e57013759c285caa701eb6
async function main() {
  let priceVoterCount = +process.argv[2];
  if (!priceVoterCount) priceVoterCount = DEFAULT_VOTER_COUNT;
  let finalizerCount = +process.argv[3];
  if (!finalizerCount) finalizerCount = DEFAULT_FINALIZER_COUNT;
  let batchId = +process.argv[4];
  if (!batchId) batchId = DEFAULT_BATCH_ID;

  const parameters = loadFTSOParameters();
  const web3 = getWeb3(parameters.rpcUrl.toString());

  const totalAccounts = priceVoterCount * 2 + finalizerCount;
  const accountOffset = batchId * totalAccounts;
  const accounts: AccountDetails[] = JSON.parse(fs.readFileSync("coston2-250-accounts.json", "utf-8")).slice(
    accountOffset,
    accountOffset + totalAccounts
  );
  console.log(`Loaded ${accounts.length} accounts.`);
  await fundAccounts(web3, accounts);
  console.log("Funded accounts.");
  await runFinalizers(DEFAULT_FINALIZER_COUNT, accounts);

  await runVoters(priceVoterCount, accounts);

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

async function runVoters(voterCount: number, accounts: AccountDetails[]) {
  for (let i = 1; i <= voterCount; i++) {
    const id = i * 2 - 1;
    startPriceVoter(id, {
      ...process.env,
      VOTER_PRIVATE_KEY: accounts[id].privateKey,
    });
    await sleepFor(200);
    startRewardVoter(id, id + 1, {
      ...process.env,
      VOTER_PRIVATE_KEY: accounts[id].privateKey,
      REWARD_VOTER_PRIVATE_KEY: accounts[id + 1].privateKey,
    });
    await sleepFor(800);
  }
}

function startPriceVoter(id: number, envConfig: any): ChildProcess {
  const process = spawn("yarn", ["ts-node", "deployment/scripts/run-price-voter.ts", id.toString(), "random"], {
    env: envConfig,
  });
  process.stdout.on("data", function (data) {
    console.log(`[PriceVoter ${id}]: ${data}`);
  });
  process.stderr.on("data", function (data) {
    console.log(`[PriceVoter ${id}] ERROR: ${data}`);
  });
  process.on("close", async function (code) {
    console.error(`PriceVoter ${id} exited with code ${code}, restarting...`);
    await sleepFor(1000);
    startPriceVoter(id, envConfig);
  });
  return process;
}

function startRewardVoter(voterId: number, id: number, envConfig: any): ChildProcess {
  const process = spawn(
    "yarn",
    ["ts-node", "deployment/scripts/run-reward-voter.ts", voterId.toString(), id.toString()],
    {
      env: envConfig,
    }
  );
  process.stdout.on("data", function (data) {
    console.log(`[RewardVoter ${id}]: ${data}`);
  });
  process.stderr.on("data", function (data) {
    console.log(`[RewardVoter ${id}] ERROR: ${data}`);
  });
  process.on("close", async function (code) {
    console.error(`RewardVoter ${id} exited with code ${code}, restarting...`);
    await sleepFor(1000);
    startRewardVoter(voterId, id, envConfig);
  });
  return process;
}

async function runFinalizers(finalizerCount: number, accounts: AccountDetails[]) {
  for (let i = accounts.length - finalizerCount; i < accounts.length; i++) {
    const envConfig = {
      ...process.env,
      FINALIZER_KEY: accounts[i].privateKey,
    };
    startFinalizer(i, envConfig);
    await sleepFor(1000);
  }
}

function startFinalizer(id: number, envConfig: any): ChildProcess {
  const process = spawn("yarn", ["ts-node", "deployment/scripts/run-finalizer.ts", id.toString()], {
    env: envConfig,
  });
  process.on("close", async function (code) {
    console.error(`Finalizer ${id} exited with code ${code}, restarting...`);
    await sleepFor(1000);
    startFinalizer(id, envConfig);
  });
  return process;
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
