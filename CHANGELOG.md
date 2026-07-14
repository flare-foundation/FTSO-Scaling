# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-07-14

### Reward epoch 417 activation

- FIP.16 vote-power unification: the FTSO median voting weight becomes the normalized on-chain
  signing-policy weight (capped WFLR delegations plus P-chain stake counted 5x) instead of capped WFLR
  delegations only. Flare and Songbird activate at reward epoch 417 (Flare starts 2026-07-20 07:00 UTC);
  Coston, Coston2, and local-test keep the pre-FIP.16 behaviour. Songbird has no P-chain staking and is
  activated for code parity.
  See `docs/migrations/FIP-16-signing-weight-unification.md`.
- FIP.16 FDC fee split: 90% of the fees of confirmed attestation requests on Flare is directed to the FIRE
  pool as a direct reward claim; the remainder is distributed with the FDC reward offers as before, and
  fees of unconfirmed requests are still burned in full.
  See `docs/migrations/FIP-16-fdc-fire-fee-split.md`.
- Flare and Songbird switch to the new VoterRegistry and FlareSystemsCalculator addresses and event ABIs,
  while retaining the legacy contracts for historical reward epochs.
- Consensus-affecting corrections activate at the same boundary: community-offer values use plain-sum feed
  ordering, random-only reveals are accepted as all-empty feed values, zero-weight votes are excluded from
  median and quartile calculation, and reveal benching and historical reward processing use the new rules.
  Before epoch 417, these paths preserve v1.0.9 behaviour for historical and mixed-version consistency.

### Added

- Support for the "FSP" indexer mode, where the indexer retains FSP event logs further back than fully
  indexed blocks.
- Configurable timeout and maximum response size for feed value provider requests
  (`FEED_VALUE_PROVIDER_TIMEOUT_MS`, default 30000; `FEED_VALUE_PROVIDER_MAX_RESPONSE_BYTES`,
  default 10 MiB).
- CI test coverage reporting; test suite restructured to mirror the source tree.

### Changed

- Migrated from web3.js to ethers v6.
- Renamed the indexer log-floor state to `first_database_log_block`; running in FSP indexer mode requires
  an indexer version that writes this state.
- Bridged the TON/USD feed rename to GRAM/USD in reward calculation.

### Fixed

- Empty or too-short reveal payloads are rejected instead of halting voting round processing.
- Indexer range assurance distinguishes FSP-event history from fully indexed blocks, so FSP-mode floors
  no longer vouch for transactions and voting-round events they do not cover; the lowest indexed event
  timestamp is also computed correctly when no state rows are present.
- Feed values are validated before encoding: non-finite values are rejected, empty packed values decode
  as all-empty feeds, and non-hex packed values are rejected.
- Attacker-controllable submission payloads are summarised and truncated in debug logs.
- Signing policy hashing validates the encoded input length instead of hashing truncated input.
- Voter addresses are normalized in random benching accumulation.
- Reward epoch duration lookup throws on a missing `SigningPolicyInitialized` event instead of returning
  a wrong range.
- The first community reward offer's decimals are preserved when later offers for the same feed disagree.

## [1.0.9] - 2026-04-17

### Changed

- Handle Coston `VoterRegistry` and `VoterPreRegistry` contract upgrade.

### Fixed

- Excluded zero-weight voters from FDC signing reward calculation.

## [1.0.7] - 2026-03-16

### Changed

- Logging fix: reduce reveal message parsing error spam.

## [1.0.6] - 2026-03-09

### Changed

- Switched from Yarn to pnpm package manager.
- Updated Dockerfile to only include `ftso-data-provider` and start it automatically. 
No need to pass an extra command to the container anymore.

## [1.0.5] - 2026-02-19

### Changed

- `Relay` contract address updates
