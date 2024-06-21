# Analytics command lines

Analytics command line calls provide certain summary printouts that show the situation on the network.
All the results base on calculation data from reward calculator. Consequently, this data must be calculated before
command lines are used.

All calls assume that certain variables are set. The most important ones are:
- `NETWORK` - should be one of `songbird`, `coston`, `flare`, `coston2`
- `RPC` - certain calls use RPC link to communicate with the networks node (reading from contracts or sending transactions)
- `PRIVATE_KEYS` - some calls send certain transactions to the blockchain. They need one or more private keys. For such calls
the variable should have `0x`-prefixed comma separated list of private keys. A user should take care of proper protection of the private keys when using such calls.
Some calls which are not security sensitive can be thus carried out in the form similar to:

```bash
env NETWORK=coston RPC=https://coston-api.flare.network/ext/bc/C/rpc <callAsBelow>
```

# Calculating reward data
Use:

```bash
./scripts/rewards/<network>-db.sh
```

Where `<network>` stands for one of `songbird`, `coston`, `flare`, `coston2`.
See the details in a specific script file itself and [here](../../scripts/rewards/README.md).

## Reward epoch info

Lists general data about reward epochs, like whether the reward epoch started and ended on time or got delayed, number of voters and their weights.

```bash
yarn ts-node scripts/analytics/run/reward-epoch-summary.ts [startRewardEpochId] [endRewardEpochId]
```

Note that if end reward epoch id is not provided the latest 
reward epoch folder number's in the `calculations` folder is taken.

## Signature deposition stats

Prints out text summary of when and by who signatures were deposited in a specific reward epoch, each line describing one voting round.
Env variable `NETWORK` must be set and data for the specific reward epoch must be calculated in the `calculations` folder.

```bash
yarn NETWORK=coston ts-node scripts/analytics/run/signatures.ts <rewardEpochId>
```

## Finalization stats

Prints out text summary of when and by who finalizations were carried out in a specific reward epoch, each line describing one voting round.
Env variable `NETWORK` must be set and data for the specific reward epoch must be calculated in the `calculations` folder.

```bash
env NETWORK=coston yarn ts-node scripts/analytics/run/finalizations.ts <rewardEpochId>
```

## Reward stats

Prints reward stats for a given reward epoch. Env variable `NETWORK` must be set.

```bash
env NETWORK=coston yarn ts-node scripts/reward-finalizer-helper.ts stats <rewardEpochId>
```

Note that this call also carries out the checks that all Merkle proofs match and that the sum of claims matches the total reward on smart contract. For the latter check to be carried out `RPC` env variable needs to be set.

Alternatively, one can get CSV with breakdown of partial detailed reward claims.

```bash
env NETWORK=coston yarn ts-node scripts/analytics/run/reward-claims-csv.ts test.csv <startRewardEpoch> <endRewardEpoch>
```

The CSV can be imported to Excel and filters can be used to analyze the detailed claims.

## Uptime and reward finalization stats

Prints up time and reward finalization stats.

```bash
env NETWORK=coston yarn ts-node scripts/reward-finalizer-helper.ts finalizations <startRewardEpochId> [endRewardEpochId]
```

## Uninitialized weight based claims 

Lists uninitialized weight based claims for a given reward epoch id.

```bash
env NETWORK=coston yarn ts-node scripts/reward-finalizer-helper.ts uninitialized <rewardEpochId>
```

## Feed values

Prints feed values info for voting epochs in a given reward epoch for a given feed.
```bash
yarn ts-node scripts/analytics/run/feeds.ts <rewardEpochId> <feedIdOrIndex> [startVotingRoundId] [endVotingRoundId]
```
