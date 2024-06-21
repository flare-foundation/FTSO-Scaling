# FTSO Scaling

The repository contains services to support [FTSO Scaling protocol](./protocol/README.md) which include:
- [Data provider service](./apps/ftso-data-provider/src/README.md)
- [Reward calculator](./scripts/rewards/README.md)
- [Reward data analytics scripts](./scripts/analytics/README.md)

The services are [Nest.js](https://nestjs.com/) applications which use logic  that is implemented in [FTSO core library](./libs/ftso-core/)

# Reward calculation results

Reward calculation results are available [here](./rewards-data).

# Installation 

## FTSO data provider

- Install Node.js (ideally 20.11.0 LTS).
- Install, configure and run the [Flare System C-chain Indexer](https://gitlab.com/flarenetwork/flare-system-c-chain-indexer).
- Install [Nest.js CLI](https://docs.nestjs.com/first-steps)
- Clone the repo. 
- Build the project
```bash
yarn build
```
- Configure relevant [environment variables](../apps/ftso-reward-calculator/src/config/configuration.ts). 
- Run the code:
```bash
node dist/apps/ftso-data-provider/apps/ftso-data-provider/src/main.js
```

## FTSO Reward Calculator (experimental)

[Reward calculator](./scripts/rewards/README.md) is a command line script that calculates rewards for FTSOv2 protocols.
It uses the [Flare system C-chain indexer](https://github.com/flare-foundation/flare-system-c-chain-indexer) database.

## FTSO Reward data analytics scripts

A [few scripts](scripts/analytics/README.md) that enable insight into reward calculation data.
