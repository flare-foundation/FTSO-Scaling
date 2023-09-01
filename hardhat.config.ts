import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-network-helpers";
import "@nomicfoundation/hardhat-toolbox";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-truffle5";
import "@nomiclabs/hardhat-web3";

import { HardhatUserConfig, task } from "hardhat/config";
import { deployContracts } from "./deployment/tasks/deploy-contracts";
import loadTestAccounts from "./hardhat.utils";

import * as dotenv from "dotenv";
import { loadFTSOParameters } from "./deployment/config/FTSOParameters";
import { OUTPUT_FILE } from "./deployment/tasks/common";
import { runAdminDaemon } from "./deployment/tasks/run-admin-daemon";

dotenv.config();

// Tasks

task("deploy-contracts", `Deploys contracts and generates a file with addresses at ${OUTPUT_FILE}.`) // prettier-ignore
  .setAction(async (_args, hre, _runSuper) => {
    const parameters = loadFTSOParameters();
    await deployContracts(hre, parameters);
  });

task("run-admin-daemon", `Does admin tasks`) // prettier-ignore
  .setAction(async (_args, hre, _runSuper) => {
    const parameters = loadFTSOParameters();
    await runAdminDaemon(hre, parameters);
  });

// Config

const accounts = loadTestAccounts();
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

  mocha: {
    // Longer timeout for E2E tests which simulate multiple FTSO reward epochs.
    timeout: 100000000, 
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
      /**
       * Should be kept in sync with changes to BUFFER_TIMESTAMP_OFFSET specified in VotingManager.sol.
       * If the initialDate is lower the contract will fail to compute price epochs.
       */
      initialDate: "2023-06-07",
      blockGasLimit: 8000000, // 8M
      /*
        Normally each Truffle smart contract interaction that modifies state results in a transaction mined in a new block
        with a +1s block timestamp. This is problematic because we need perform multiple smart contract actions
        in the same price epoch, and the block timestamps end up not fitting into an epoch duration, causing test failures.
        Enabling consecutive blocks with the same timestamp is not perfect, but it alleviates this problem.
        A better solution would be manual mining and packing multiple e.g. setup transactions into a single block with a controlled
        timestamp, but that  would make test code more complex and seems to be not very well supported by Truffle.
      */
      allowBlocksWithSameTimestamp: true,
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
