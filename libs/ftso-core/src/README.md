# FTSO Scaling core library

The library implements protocol logic both for protocol data provider and reward calculation.
The organization of code is as follows.

## Folders

- `configs` - network dependant constants and configurations.
- `events` - classes for parsing blockchain events from specific contracts that are used in FTSO scaling protocol.
- `ftso-calculation` - function libraries to perform median calculations for data feeds on the prepared data, that is extracted from [DataManager](./DataManager.ts) object.
- `orm` - TypeORM entity definition for interaction with the indexer database.
- `reward-calculation` - function libraries to perform reward calculation on the prepared data, that is extracted from `DataManager` object.
- `utils` - various util classes for data and event encoding, data classes for calculation (commits, reveals, offers, reward claims), epoch calculation classes and ABI management classes, Merkle tree logic, etc.

## Files

- `DataForCalculations.ts` - Typescript interfaces for data objects extracted from `DataManager` as inputs for calculations.
- `IndexerClient.ts` - a client for connection to Flare c-chain indexer database. It implements all elementary queries for access to the relevant indexer database data. The indexer client is used directly by `DataManager` and `RewardEpochManager` classes.
- `DataManager.ts` - implements data manager class that implements methods for obtaining data by relevant queries through `IndexerClient` and its processing into the form as described in `DataForCalculations.ts`, which is ready as an input to calculation logic, both for FTSO protocol and rewards.
- `RewardEpoch.ts` - a class that possesses total knowledge of a specific reward epoch. This includes all events, appearing in signing policy lifecycle, the signing policy itself, all reward offers, all voter registration and mappings between all the entity addresses and canonical order of feeds.
- `RewardEpochManager.ts` - a class that manages initialization and construction of `RewardEpoch` objects that get cached. One of the main functionality is providing the correct RewardEpoch object for a given voting round id.
