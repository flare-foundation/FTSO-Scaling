import { loadAccounts } from "../tasks/common";
import { getWeb3 } from "../../src/utils/web3";
import { ChildProcess, execSync, spawn } from "child_process";
import { retry } from "../../src/utils/retry";
import { sleepFor } from "../../src/utils/time";
import { promisify } from "util";
import Web3 from "web3";

const PRICE_VOTER_COUNT = 3;
const FINALIZER_COUNT = 2;
const RPC = "http://127.0.0.1:8545";

/**
 * This script is used to run a local simulation of the FTSO on the local hardhat network.
 * It deploys contracts and starts a cluster of data providers.
 */
async function main() {
  const childProcesses = [];

  try {
    childProcesses.push(startNetwork());

    const web3 = await retry(() => getWeb3(RPC), 3, 1000);

    setIntervalMining(web3);

    const accounts = loadAccounts(web3);
    const envConfig = {
      ...process.env,
      CHAIN_CONFIG: "local",
      DEPLOYER_PRIVATE_KEY: accounts[0].privateKey,
    };
    process.env = envConfig;

    deployContracts(envConfig);

    let id = 1; // 0 is reserved for governance account
    for (let i = 0; i < PRICE_VOTER_COUNT; i++) {
      childProcesses.push(startPriceVoter(id++));
      await sleepFor(1000);
    }
    setTimeout(() => {
      for (let i = 0; i < PRICE_VOTER_COUNT; i++) {
        childProcesses.push(startRewardVoter(id++));
        sleepFor(1000);
      }
    }, 30_000);

    for (let i = 0; i < FINALIZER_COUNT; i++) {
      childProcesses.push(startFinalizer(id++));
      await sleepFor(1000);
    }

    childProcesses.push(startAdminDaemon());

    while (true) {
      await sleepFor(10_000);
    }
  } catch (e) {
    childProcesses.forEach(p => p.kill());
    throw e;
  }
}

function deployContracts(envConfig: any) {
  execSync("yarn c && yarn hardhat deploy-contracts --network local", { stdio: "inherit", env: envConfig });
}

function startNetwork(): ChildProcess {
  const process = spawn("yarn", ["hardhat", "node"]);
  process.stderr.on("data", function (data) {
    console.error(`Hardhat error: ${data}`);
  });
  process.on("close", function (code) {
    throw new Error(`Hardhat process exited with code ${code}, aborting.`);
  });
  return process;
}

function startAdminDaemon(): ChildProcess {
  const process = spawn("yarn", ["hardhat", "run-admin-daemon", "--network", "local"]);
  process.stdout.on("data", function (data) {
    console.log(`[Admin daemon]: ${data}`);
  });
  process.stderr.on("data", function (data) {
    console.log(`[Admin daemon] ERROR: ${data}`);
  });
  process.on("close", function (code) {
    throw new Error(`Admin daemon exited with code ${code}, aborting.`);
  });
  return process;
}

function startPriceVoter(id: number): ChildProcess {
  const process = spawn("yarn", ["ts-node", "deployment/scripts/run-price-voter.ts", id.toString(), "random"]);
  process.stdout.on("data", function (data) {
    console.log(`[PriceVoter ${id}]: ${data}`);
  });
  process.stderr.on("data", function (data) {
    console.log(`[PriceVoter ${id}] ERROR: ${data}`);
  });
  process.on("close", function (code) {
    console.log("closing code: " + code);
    throw Error(`PriceVoter ${id} exited with code ${code}`);
  });
  return process;
}

function startFinalizer(id: number): ChildProcess {
  const process = spawn("yarn", ["ts-node", "deployment/scripts/run-finalizer.ts", id.toString()]);
  process.stdout.on("data", function (data) {
    console.log(`[Finalizer ${id}]: ${data}`);
  });
  process.stderr.on("data", function (data) {
    console.log(`[Finalizer ${id}] ERROR: ${data}`);
  });
  process.on("close", function (code) {
    console.log("closing code: " + code);
    throw Error(`Finalizer ${id} exited with code ${code}`);
  });
  return process;
}

function startRewardVoter(id: number): ChildProcess {
  const process = spawn("yarn", ["ts-node", "deployment/scripts/run-reward-voter.ts", (id - PRICE_VOTER_COUNT - FINALIZER_COUNT).toString(), id.toString()]);
  process.stdout.on("data", function (data) {
    console.log(`[Reward voter ${id}]: ${data}`);
  });
  process.stderr.on("data", function (data) {
    console.log(`[Reward voter ${id}] ERROR: ${data}`);
  });
  process.on("close", function (code) {
    console.log("closing code: " + code);
    throw Error(`Reward voter ${id} exited with code ${code}`);
  });
  return process;
}

/** Configures Hardhat to automatically mine blocks in the specified interval. */
export async function setIntervalMining(web3: Web3, interval: number = 1000) {
  await promisify((web3.currentProvider as any).send.bind(web3.currentProvider))({
    jsonrpc: "2.0",
    method: "evm_setAutomine",
    params: [false],
    id: new Date().getTime(),
  });

  await promisify((web3.currentProvider as any).send.bind(web3.currentProvider))({
    jsonrpc: "2.0",
    method: "evm_setIntervalMining",
    params: [interval],
    id: new Date().getTime(),
  });
}

main();
