import "@nomicfoundation/hardhat-toolbox";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-truffle5";
import "@nomiclabs/hardhat-web3";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-network-helpers";

import { HardhatUserConfig, task } from "hardhat/config";
import { runDataProvider } from "./deployment/tasks/run-data-provider";
import { deployContracts } from "./deployment/tasks/deploy-contracts";
import loadTestAccounts, { getFTSOParameters as loadFTSOParameters } from "./hardhat.utils";

import * as dotenv from "dotenv";
import { OUTPUT_FILE } from "./deployment/tasks/common";
import { runAdminDaemon } from "./deployment/tasks/run-admin-daemon";

dotenv.config();

// Tasks

task("deploy-contracts", `Deploys contracts and generates a file with addresses at ${OUTPUT_FILE}.`) // prettier-ignore
  .setAction(async (args, hre, runSuper) => {
    const parameters = loadFTSOParameters();
    await deployContracts(hre, parameters);
  });

task("run-admin-daemon", `Does admin tasks`) // prettier-ignore
  .setAction(async (args, hre, runSuper) => {
    const parameters = loadFTSOParameters();
    await runAdminDaemon(hre, parameters);
  });

task("run-data-provider", "Runs a single data provider with the specified id (account index).")
  .addPositionalParam("id")
  .setAction(async (taskArgs, hre) => {
    const parameters = loadFTSOParameters();
    await runDataProvider(hre, taskArgs.id, parameters);
  });

// Config

let accounts = loadTestAccounts();
const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.18",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
      {
        version: "0.6.7",
        settings: {},
      },
    ],
    overrides: {
      "contracts/utils/Imports.sol": {
        version: "0.6.12",
        settings: {},
      },
    },
  },

  defaultNetwork: "hardhat",

  networks: {
    scdev: {
      url: "http://127.0.0.1:9650/ext/bc/C/rpc",
      timeout: 40000,
      accounts: accounts.map((x: any) => x.privateKey),
    },
    staging: {
      url: process.env.STAGING_RPC || "http://127.0.0.1:9650/ext/bc/C/rpc",
      timeout: 40000,
      accounts: accounts.map((x: any) => x.privateKey),
    },
    songbird: {
      url: process.env.SONGBIRD_RPC || "https://songbird-api.flare.network/ext/C/rpc",
      timeout: 40000,
      accounts: accounts.map((x: any) => x.privateKey),
    },
    flare: {
      url: process.env.FLARE_RPC || "https://flare-api.flare.network/ext/C/rpc",
      timeout: 40000,
      accounts: accounts.map((x: any) => x.privateKey),
    },
    coston: {
      url: process.env.COSTON_RPC || "https://coston-api.flare.network/ext/C/rpc",
      timeout: 40000,
      accounts: accounts.map((x: any) => x.privateKey),
    },
    coston2: {
      url: process.env.COSTON2_RPC || "https://coston2-api.flare.network/ext/C/rpc",
      timeout: 40000,
      accounts: accounts.map((x: any) => x.privateKey),
    },
    hardhat: {
      accounts,
      initialDate: "2021-01-01", // no time - get UTC @ 00:00:00
      blockGasLimit: 8000000, // 8M
    },
    local: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
  },
  paths: {
    sources: "./contracts/",
    tests: process.env.TEST_PATH || "test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
