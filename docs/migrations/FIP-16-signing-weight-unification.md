# FIP.16 — Unification of vote power onto signing weight

This document records the analysis behind, and the implementation of, the FTSO-relevant part of
[FIP.16](https://proposals.flare.network/FIP/FIP_16.html) ("FLR Tokenomics Restructuring", accepted 2026-04-24) in
this repository.

> **Status:** implemented behind a per-network activation reward epoch that is currently set to a sentinel far in the
> future (`FIP16_NOT_ACTIVATED`). Until the real on-chain activation epochs are filled in, the code reproduces the
> pre-FIP.16 behaviour byte-for-byte. See [Activation](#activation).

## 1. What FIP.16 changes (the part that affects this repo)

FIP.16 is broad (inflation, FIRE, fees, …) but only one clause touches FTSO Scaling reward calculation and the data
provider:

> *"The current voting power calculation gives equal importance to P-chain staked tokens and C-chain (WFLR)
> delegations, **with the exception of FTSO anchor feeds, which rely solely on C-chain delegations**."*
>
> *"…unify votepower calculation across all the FSP protocols on the C-chain: **FDC, FTSO Anchor feeds, and FTSO
> block-latency feeds**, to rely on what is currently known as the **signing weight** … assigning a higher weight to
> P-chain stake, initially set at **5×** relative to C-chain power."*

Two mechanical consequences:

1. **FTSO anchor-feed (scaling) median weighting** switches from *C-chain delegation only* to the *signing weight*
   (delegation **+** stake).
2. **P-chain stake is counted 5×** relative to C-chain WFLR when reward amounts are split between delegators and
   stakers. (FIP.16 also raises the max validator node size 200M→300M; that cap is enforced on-chain and needs no
   change here.)

FIP.16 also introduces a minimum 20% entity fee share. That fee floor is enforced by the smart contracts and reflected
in the emitted voter-registration data consumed by this repository, so the reward calculator continues to use the
emitted `delegationFeeBIPS` value as authoritative.

## 2. On-chain vs off-chain: what actually had to change

The signing weight per voter (`signingPolicy.weights[i]`) is computed **on-chain** by `FlareSystemsCalculator` and
read from the `SigningPolicyInitialized` event. After FIP.16 it already bakes in the 5× stake factor. Therefore:

- The **share** a voter earns from signing / finalization / FDC rewards is driven by that on-chain signing weight and
  needs **no change** here.
- What is decided **off-chain in this repo** is (a) which weight the **median** uses, and (b) how an earned reward is
  **split between a voter's own delegators (WNAT) and stakers (MIRROR)**. These had to change.

Per the answers that scoped this work:

- **Median (consensus + earning) uses the normalized weight** = the on-chain signing-policy weight (uint16). The
  normalized weight both decides the median value/IQR membership and how much each voter earns.
- **The split of an earned reward to delegators vs stakers uses the ratio `cappedDelegation : 5·stake`.**

The signing-policy weights are uint16-normalized (coarse), so the median deliberately uses that normalized value
(consensus must be deterministic across all data providers); the higher-resolution `cappedDelegation + 5·stake` is used
only inside the per-voter delegation/stake split.

## 3. Code changes

All changes are gated on `isFip16Active(rewardEpochId)` / `stakeWeightMultiplier(rewardEpochId)` from
`libs/ftso-core/src/constants.ts`. When inactive (the current default), every path falls back to the exact pre-FIP.16
behaviour.

| Area | File | Before | After (when active) |
|------|------|--------|---------------------|
| Median influence weight | `libs/ftso-core/src/RewardEpoch.ts` — `ftsoMedianVotingWeight` | `wNatCappedWeight` | normalized signing-policy weight (`submitAddressToSigningWeight`) |
| Median earning weight | `libs/fsp-rewards/src/reward-calculation/reward-utils.ts` — `medianRewardDistributionWeight` | `cappedDelegationWeight` | `BigInt(signingWeight)` |
| Median reward split | `libs/fsp-rewards/src/reward-calculation/reward-median.ts` | fee + WNAT only | `generateSigningWeightBasedClaimsForVoter` (FEE + WNAT + MIRROR, stake ×5) |
| Within-voter split | `libs/fsp-rewards/src/reward-calculation/reward-signing-split.ts` — `generateSigningWeightBasedClaimsForVoter` | `cappedDelegation + stake` (1:1) | `cappedDelegation + 5·stake` |
| Fast-updates (block latency) split | `libs/fsp-rewards/src/reward-calculation/reward-fast-updates.ts` | fee + WNAT only | `generateSigningWeightBasedClaimsForVoter` (FEE + WNAT + MIRROR, stake ×5) |
| Penalties weight + split | `libs/fsp-rewards/src/reward-calculation/reward-penalties.ts` | delegation weight + 1:1 split | signing weight + 5× split |
| Signing / finalization / FDC split | `reward-signing.ts`, `reward-finalization.ts`, `fdc/reward-fdc-signing.ts`, `fdc/reward-fdc-penalties.ts` | 1:1 split | 5× split (share itself already on-chain) |

`stakeWeightMultiplier(rewardEpochId)` is threaded into `generateSigningWeightBasedClaimsForVoter` (via the
`rewardEpochId` parameter) and applied to the staked weight when computing the delegation-vs-stake split. The
node-to-node sub-distribution stays proportional to raw node weights (the multiplier cancels), so per-node shares are
unchanged.

For FTSO block-latency feeds, the reward opportunity is treated as already earned through the signing-weight-based
protocol mechanics. The calculator therefore keeps the existing per-submission share assignment and applies FIP.16 to
the split of that earned share into capped delegation and 5× stake.

### Median-eligibility for signing/finalization rewards

A voter is eligible for signing/finalization rewards if it earned a non-zero accuracy (median) reward. Before FIP.16
that set was reconstructed from the WNAT (delegation) claims produced by the median. Once stakers can earn accuracy
rewards, a stake-only voter may produce no WNAT claim, so `calculateMedianRewardClaims` now also returns the set of
signing addresses that received a positive accuracy reward (`rewardedSigningAddresses`). The orchestrator
(`reward-calculation.ts`) uses that precise set when FIP.16 is active and keeps the legacy WNAT-reconstruction when it
is not (preserving historical results exactly).

### Reward detail tags

When active, the Median and Fast-updates accuracy rewards are split with the signing-weight detail tags
(`FEE_FOR_DELEGATION_AND_STAKING`, `DELEGATION_COMMUNITY_REWARD`, `NODE_COMMUNITY_REWARD`) instead of the previous
`FEE` / `PARTICIPATION` tags, because stake now participates. The `rewardTypeTag` is unchanged (`Median`,
`Fast updates accuracy`).

## 4. Activation

`libs/ftso-core/src/constants.ts`:

- `FIP16_ACTIVATION_REWARD_EPOCH()` — per-network first reward epoch (inclusive) at which FIP.16 applies. **All
  networks are currently set to `FIP16_NOT_ACTIVATED` (`Number.MAX_SAFE_INTEGER`).** Fill in the real epoch ids once
  the matching on-chain `FlareSystemsCalculator` deployment epoch is known for each network. For `from-env`, the value
  is read from the `FIP16_ACTIVATION_REWARD_EPOCH` environment variable and must be a non-negative safe integer.
- `FIP16_STAKE_WEIGHT_MULTIPLIER = 5n` — the stake multiplier (governance-adjustable in the future).
- `isFip16Active(rewardEpochId)` / `stakeWeightMultiplier(rewardEpochId)` — the gating helpers used throughout.

### ⚠️ Consensus-critical coordination

`ftsoMedianVotingWeight` is consumed by the **live data provider** (via `DataManager`), not just the reward
calculator. Changing it changes the median *values*. Every data provider must switch at the **exact** same reward epoch
— the one in which the matching on-chain signing-weight change for anchor feeds takes effect — or medians will diverge
and rounds will fail to finalize. Data providers are expected to run a build of this code in which
`FIP16_ACTIVATION_REWARD_EPOCH` has been set to the correct value for their network. The reward calculator
recomputes history, so an incorrect (too-early) activation epoch would also make recomputed Merkle roots diverge from
the published ones.

## 5. Open items

- Fill in `FIP16_ACTIVATION_REWARD_EPOCH` for `flare`, `songbird`, `coston`, `coston2` once the on-chain activation
  epochs are known. Confirm whether the FTSO weight clause applies to Songbird, and with what multiplier.
- Add activation-on end-to-end/golden tests once the real epochs are set. Unit coverage already exercises strict
  activation parsing, median computed on signing weight, accuracy/fast-update rewards split to stakers (MIRROR claims),
  and stake-only voters being eligible for signing rewards.
