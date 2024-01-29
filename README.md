# FTSO Scaling

The repository contains services to support [FTSO Scaling protocol](./protocol/README.md) which include:
- [Data provider service](./apps/ftso-data-provider/src/README.md)
- [Reward calculator service](./apps/ftso-reward-calculator/src/README.md)

The services are [Nest.js](https://nestjs.com/) applications which use logic, that is implemented in [FTSO core library](./libs/ftso-core/)

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

Same as above, except for running the code use 
```bash
node dist/apps/ftso-reward-calculator/src/main.js
```
