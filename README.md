<div align="center">
  <a href="https://flare.network/" target="blank">
    <img src="https://content.flare.network/Flare-2.svg" width="300" alt="Flare Logo" />
  </a>
  <br/>
  <a href="CONTRIBUTING.md">Contributing</a>
  ·
  <a href="SECURITY.md">Security</a>
  ·
  <a href="CHANGELOG.md">Changelog</a>
</div>

# FTSO Scaling

The repository contains services to support [FTSO Scaling protocol](./protocol/README.md) which include:
- [Data provider service](./apps/ftso-data-provider/src/README.md)
- [Reward calculator](./scripts/rewards/README.md)
- [Reward data analytics scripts](./scripts/analytics/README.md)

The services are [Nest.js](https://nestjs.com/) applications which use logic that is implemented in [FTSO core library](./libs/ftso-core/).

## FTSO Reward Calculator (experimental)

[Reward calculator](./scripts/rewards/README.md) is a command line script that calculates rewards for FTSOv2 protocols.
It uses the [Flare system C-chain indexer](https://github.com/flare-foundation/flare-system-c-chain-indexer) database.

## FTSO Reward data analytics scripts

A [few scripts](scripts/analytics/README.md) that enable insight into reward calculation data.
