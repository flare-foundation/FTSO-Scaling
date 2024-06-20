# Analytics command lines

Analytics command line calls provide certain summary printouts that show the situation on the network.
All the results base on calculation data from reward calculator. Consequently, this data must be calculated before
command lines are used.
Currently, calculations for Coston only can be done.

# Calculating reward data
Use:

```bash
./scripts/rewards/coston-db.sh
```
This will trigger calculations from reward epoch id 2380 on. If other ranges are needed, parameters of the call in the file should be adjusted accordingly.

## Reward epoch info

Lists general data about reward epoch info, like whether the reward epoch started and ended on time or got delayed, number of voters and their weights.

```bash
env NETWORK=coston yarn ts-node scripts/analytics/run/reward-epoch-summary.ts [startRewardEpochId] [endRewardEpochId]
```

Note that default start reward epoch id for `coston` is 2380, and if end reward epoch id is not provided the latest 
reward epoch folder number's in the calculations folder is taken.

## Signature deposition stats


```bash
env NETWORK=coston yarn ts-node scripts/analytics/run/signatures.ts <rewardEpochId>
```

## Finalization stats

```bash
env NETWORK=coston yarn ts-node scripts/analytics/run/finalizations.ts <rewardEpochId>
```


## Reward stats

Prints reward stats for a given reward epoch.

```bash
env NETWORK=coston yarn ts-node scripts/reward-finalizer-helper.ts stats <rewardEpochId>
```

Alternatively, one can get CSV with breakdown of partial reward claims.

```bash
env NETWORK=coston yarn ts-node scripts/analytics/run/reward-claims-csv.ts test.csv <startRewardEpoch> <endRewardEpoch>
```

The CSV can be imported to Excel and filters can be used to analyze claims.

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
