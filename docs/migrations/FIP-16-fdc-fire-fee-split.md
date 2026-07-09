# FIP.16 — FDC data request fee split to FIRE

This document records the implementation of the FDC-fee clause of
[FIP.16](https://proposals.flare.network/FIP/FIP_16.html) (§4.1, "FDC data request fees") in this repository. The
vote-power clause is covered separately in [FIP-16-signing-weight-unification.md](FIP-16-signing-weight-unification.md).

> **Status:** implemented behind the shared FIP.16 activation reward epoch (`FIP16_ACTIVATION_REWARD_EPOCH`). On
> Flare the split activates at reward epoch 416 (expected start 2026-07-16 19:00:00 UTC); other networks remain at
> the `FIP16_NOT_ACTIVATED` sentinel and reproduce the pre-FIP.16 behaviour byte-for-byte.

## 1. What FIP.16 changes

> *"For each request, 10% of the fees will be distributed alongside inflation – consistent with the current model –
> while the remaining 90% will be directed to FIRE."*

FIRE (Flare Income Reinvestment Entity) is the umbrella entity collecting network revenues. On-chain, `FdcHub`
keeps forwarding **100%** of attestation request fees to the `RewardManager`, so the redirection is realized by the
reward calculator: the FIRE share of the fees of **confirmed** attestation requests is carved out of the FDC reward
pool and emitted as a **`DIRECT` reward claim to the FIRE pool address**. Fees of unconfirmed requests keep being
burned in full (per FIP.16, fees of failed requests are burned).

## 2. Code changes

| Area | File | Behaviour (when active) |
|------|------|-------------------------|
| Constants | `libs/fsp-rewards/src/constants.ts` | `FIRE_POOL_ADDRESS` (Flare: `0x0ce6831DF00A6018c4d316009980DbAa6c44E525`, all other networks: `0x…dEaD`) and `FDC_FIRE_FEE_SPLIT_BIPS` (Flare: `9000`, all other networks: `0`; `from-env`: optional `FDC_FIRE_FEE_SPLIT_BIPS` env var, absent → `0`) |
| Offer creation | `libs/fsp-rewards/src/reward-calculation/reward-offers.ts` — `granulatedPartialOfferMapForFDC` | Per voting round: `fireFeeAmount = floor(confirmedFees × FDC_FIRE_FEE_SPLIT_BIPS / 10000)` is removed from the distributable offer and emitted as a third partial offer marked `shouldGoToFirePool`. The rounding remainder stays distributable. |
| Offer type | `libs/fsp-rewards/src/utils/PartialRewardOffer.ts` | New optional fields `shouldGoToFirePool` and `fireFeeAmount` on `IPartialRewardOfferForRound` |
| Claim generation | `libs/fsp-rewards/src/reward-calculation/reward-calculation.ts` (FDC branch) | A `shouldGoToFirePool` offer becomes a `ClaimType.DIRECT` claim to `FIRE_POOL_ADDRESS`, tagged `RewardTypePrefix.PARTIAL_FDC_OFFER_FIRE` (`"Partial FDC offer to FIRE"`), analogous to the existing burn claim |

Value is conserved per voting round: distributable offer + burn offer + FIRE offer = inflation share + all request
fees. The FIRE `DIRECT` claims merge and aggregate across voting rounds through the standard `RewardClaim.merge`
path, exactly like the burn-address claims.

## 3. Activation

The split is gated on the shared `isFip16Active(rewardEpochId)` helper (`libs/ftso-core/src/constants.ts`) — it takes
effect in the same reward epoch as the FIP.16 vote-power unification. While inactive (or on networks with a `0` bips
split), no FIRE offer is created and no new field is serialized, so offer files and reward claims — and therefore
recomputed Merkle roots for historical epochs — are byte-identical to the pre-FIP.16 output.

Unit coverage: `test/libs/fsp-rewards/fdc-fire-fee-split.test.ts` (per-network constants, from-env parsing, offer
split arithmetic incl. rounding and conservation, inactive/zero-bips dormancy).
