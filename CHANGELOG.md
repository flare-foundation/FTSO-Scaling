# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-07-10

### Added

- FIP.16 vote-power unification: once active, the FTSO median voting weight is the normalized on-chain
  signing-policy weight (capped WFLR delegations plus P-chain stake counted 5x) instead of capped WFLR
  delegations only. Gated by a per-network activation reward epoch: Flare activates at reward epoch 416
  (expected start 2026-07-16 19:00 UTC); all other networks keep the pre-FIP.16 behaviour.
  See `docs/migrations/FIP-16-signing-weight-unification.md`.
- FIP.16 FDC fee split: from the same activation epoch, 90% of the fees of confirmed attestation requests
  on Flare is directed to the FIRE pool as a direct reward claim; the remainder is distributed with the FDC
  reward offers as before, and fees of unconfirmed requests are still burned in full.
  See `docs/migrations/FIP-16-fdc-fire-fee-split.md`.
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
- Corrected community reward offer amount accumulation in the canonical feed ordering.
- Feed values are validated before encoding: non-finite values are rejected, empty packed values decode
  as all-empty feeds, and non-hex packed values are rejected.
- Attacker-controllable submission payloads are summarised and truncated in debug logs.
- Signing policy hashing validates the encoded input length instead of hashing truncated input.
- Voter addresses are normalized in random benching accumulation.
- Reward epoch duration lookup throws on a missing `SigningPolicyInitialized` event instead of returning
  a wrong range.

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
