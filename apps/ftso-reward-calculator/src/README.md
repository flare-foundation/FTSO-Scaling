# Reward calculation service

Reward calculation service is a service is used to calculate FTSO scaling rewards. Initially the reward calculation will be run by Flare Foundation and the calculated Merkle roots will be pushed through governance. Later an instance of Reward calculation service will be run by each data provider, being used by Flare System Client, which will be signing and voting for a reward merkle root each reward epoch.

The service provides API routes that [Flare System Client](https://gitlab.com/flarenetwork/flare-system-client) queries to obtain data about reward epoch rewards, in the form of a reward claims. Since FTSO Scaling is only one of the sub protocols under Flare Systems Protocol, the reward claims from Reward calculation service are collected and merged with reward claims in other subprotocols, yielding fully merged claims from which a Reward claims Merkle tree is built.
Reward calculation service depends on:

- [Flare System C-chain Indexer](https://gitlab.com/flarenetwork/flare-system-c-chain-indexer)

Reward calculation service does not directly communicate with blockchain. Instead read access to blockchain is provided through queries into indexer database while calculated information is then picked up by Flare System Client who manages sending data onto chain.

Reward calculation service implements and exposes the following [API routes](./docs/reward-calculation-service-API.md).
All the data provider's core logic is implemented in [FTSO Scaling Core library](../../../libs/ftso-core/src/README.md)
