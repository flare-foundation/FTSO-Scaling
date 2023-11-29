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

To start a simulation on the local Hardhat network, run:
```
yarn ts-node deployment/scripts/run-simulation.ts
```

This will start a Hardhat node (network), compile and deploy smart contracts, and run several process participating in the FTSOv2 protocol:

- **Reward sender**: generates and submits reward offers for feeds on every reward epoch.
- **Price voter** (x3): submits price data and participates in the price epoch voting protocol.
- **Reward voter** (x3): tracks transaction history and computes rewards for each price voter. Votes on the reward Merkle tree for each reward epoch. Currently it also claims rewards.
- **Finalizer** (x2): listens for signatures for both price and reward epochs, and attempts to submit finalization transactions once enough signature weight is observed.

Logs for each process can be found in the `logs` directory.