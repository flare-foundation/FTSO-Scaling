# Data provider service

Data provider service is a service that is run by a data provider. The service provides API routes that [Flare System Client](https://gitlab.com/flarenetwork/flare-system-client) queries to obtain data for commits, reveals and results of calculations (median prices and random number). Data provider depends on:
- [Flare System C-chain Indexer](https://gitlab.com/flarenetwork/flare-system-c-chain-indexer)
- Custom feed/price provider that supports [API routes](./docs/feed-provider-API.md) that allow for querying feed values to send into protocol.

Data providers do not directly communicate with blockchain. Instead, read access is provided through queries into indexer database while calculated information is then picked up by Flare System Client who manages sending data onto chain.

Data provider implements and exposes the following [API routes](./docs/data-provider-API.md).
All the data provider's core logic is implemented in [FTSO Scaling Core library](../../../libs/ftso-core/src/README.md)
