# FTSO Scaling protocol

This repo contains MVP of an implementation of the new FTSO Scaling protocol.

# Setup

### Node.JS

- Install [NVM](https://github.com/nvm-sh/nvm).
- Install Node v18 (LTS): 
    ```
    nvm install 18
    ```
- Set version 18 as default: 
    ```
    nvm alias default 18
    ```

### Project

- Install `yarn`: 
    ```
    npm install -g yarn
    ```
- To compile smart contracts run:
    ```
    yarn c
    ```
- To run all tests run:
    ```
    yarn test
    ```

Recommended editor to use is [VSCode](https://code.visualstudio.com/).

## Code formatting

We use `Prettier` for code formatting, with settings defined under `package.json`.

You can install the VSCode extension and use the shortcut `Alt/Option` + `Shift` + `F` to auto-format the current file.

## Running a data provider cluster locally 

The following steps describe how to get a group of data providers running locally (on Hardhat network) and participating in FTSO voting rounds.

1. Create `.env` in the project directory:
    ```
    DEPLOYER_PRIVATE_KEY=""
    CHAIN_CONFIG="local"
    ```
    Set `DEPLOYER_PRIVATE_KEY` to the first private key under `deployment/test-1020-accounts.json`. 
    By current convention, the first test account is used for governance/deployment.

2. Open a new terminal window. Start a Hardhat node. This will run the Hardhat network:
    ```
    yarn hardhat node > /tmp/hardhat_node.log
    ```

3. Open a new terminal window. Deploy contracts:
    ```
    yarn c && yarn hardhat deploy-contracts --network local
    ```    
4. Run "admin-daemon". This is a placeholder process that runs non-voter tasks such as offering rewards.
    ```
    yarn hardhat run-admin-daemon --network local 
    ```
5. Open a new terminal window. Run a data provider:
    ```
    yarn ts-node deployment/scripts/run-data-provider.ts 1
    ```
6. Repeat step (5), changing `1` to a different id to run more providers (makes sense to have at least 3 in total).
