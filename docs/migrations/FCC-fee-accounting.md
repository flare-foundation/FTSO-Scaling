# FCC — TEE and FDC2 fee accounting

This document records how the fees of the Flare Confidential Compute (FCC) contracts are accounted for in the
reward calculation.

> **Status:** implemented, gated by `FCC_ACTIVATION_REWARD_EPOCH` alone. Active on Songbird from reward epoch
> **419**, and on Coston and Coston2 from reward epoch **5877**. On Flare the activation epoch is
> `FCC_FAR_FUTURE_REWARD_EPOCH`, so FCC fees are not accounted for there yet.

## 1. Where the funds come from

Two contracts were added by the `tee_deploy` branch of `flare-smart-contracts-v2`:

| Network | `FlareTeeManager` | `Fdc2Hub` | Deployed in | Activation epoch |
|---|---|---|---|---|
| Songbird | `0x5C2dE0DeFC3FDBbF8e12c12bD0b1629Ed37DC767` | `0x4234a8f5D255d91d56df53d0cc78c0Cc2B67ACD8` | 419 | 419 |
| Coston | `0xc4885998f5D792ed88C5Af7a3AaCBe333f017658` | `0x064C7B68B0e2BC87e7bE34e89741485Fcb48FA2F` | 5730 | 5877 |
| Coston2 | `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE` | `0x04dd3Ba33aC798d400bEc42A26F82f9812A421dc` | 5826 | 5877 |
| Flare | placeholder | placeholder | — | `FCC_FAR_FUTURE_REWARD_EPOCH` |

On Coston and Coston2 the activation epoch is **later than the deployment epoch**: fees paid between the two were
credited to `RewardManager` but are claimed by no epoch (~5.7 C2FLR on Coston2, nothing on Coston). That is
accepted on test networks, where the funds are unclaimable anyway. **On a production network the activation epoch
must be the deployment epoch**, or the fees of every epoch in between go unclaimed for real value. Songbird is
configured that way: deployed and activated in 419.

Both contracts are declared for **every** network in `NetworkContractAddresses`, non-optional. The code assumes they
exist everywhere and reads their events as soon as the reward epoch reaches the activation epoch; there is no
"contract missing" branch anywhere. Flare is not an exception in the code — only in its configuration, where the
activation epoch is far enough out that the events are never read and the addresses are still placeholders.

Enabling FCC on a network therefore means two edits that belong together: fill in the two addresses in
`libs/contracts/src/constants.ts` and lower `FCC_ACTIVATION_REWARD_EPOCH` in `libs/fsp-rewards/src/constants.ts`.
Because the runtime trusts the configuration, that pairing is enforced by a test rather than a runtime check:
`fcc-fee-claims.test.ts` fails if any network has an activation epoch set while its addresses are still
placeholders. Without it, the event queries would return nothing and the reconciliation would balance at zero while
real fees sat on the `RewardManager`.

Both credit `RewardManager` through `receiveRewards`, and each `receiveRewards` call site is paired one to one with
an event emitted in the same function:

| Call site | Event | Amount in the event |
|---|---|---|
| `Instructions.sendInstructions` | `TeeInstructionsSent` | the full `msg.value` of the dispatch |
| `Fdc2Hub.requestAttestation` | `AttestationRequested` | the configured attestation type/source fee |

These are the only two `receiveRewards` callers under `contracts/tee/` and `contracts/fdc2/`.

### The two events do not double count

`Fdc2Hub.requestAttestation` splits the payment:

```solidity
rewardManager.receiveRewards{value: fee}(...);                 // -> AttestationRequested.fee
_sendRequestAttestationInstructions(..., msg.value - fee);     // -> sendSystemInstructions{value: msg.value - fee}
  └─ Instructions.sendInstructions -> receiveRewards{value: msg.value}   // -> TeeInstructionsSent.fee
```

For a request paying `P` with configured fee `F`: `AttestationRequested.fee = F` and `TeeInstructionsSent.fee =
P - F`. The two are disjoint parts of the same payment and sum to exactly `P`. Pure TEE operations (VRF, wallet key
generation, machine attestation) emit only `TeeInstructionsSent`.

Summing both events across a reward epoch therefore yields exactly the funds FCC added to `RewardManager`, with no
overlap and no gap.

### Not to be confused with FDC

FDC2 is a different subsystem from the legacy FDC, and the event names differ by two letters:

| | Legacy FDC | FCC / FDC2 |
|---|---|---|
| Contract | `FdcHub` `0xCfD4669a505A70c2cE85db8A1c1d14BcDE5a1a06` | `Fdc2Hub` `0x4234a8f5D255d91d56df53d0cc78c0Cc2B67ACD8` |
| Event | `AttestationRequest` | `AttestationRequested` |
| topic0 | `0x25137766…5918cc9` | `0x57c44139…310f5de` |
| Fee handling | inflation offers, confirmed/unconfirmed split, FIP.16 FIRE share | flat redirection to `FCC_FEES_ADDRESS` |

Nothing is shared between the two paths. The event class is named `Fdc2AttestationRequested` rather than
`AttestationRequested` so the two cannot be confused at a call site, and the FIP.16 FDC→FIRE split is untouched.

## 2. What the calculator does

Until the TEE/FCC rewarding logic exists, all FCC fees are redirected to `FCC_FEES_ADDRESS` as a `DIRECT` claim,
so that every wei credited to `RewardManager` is covered by a claim.

| Area | File | Behaviour |
|---|---|---|
| ABIs | `abi/FlareTeeManager.json`, `abi/Fdc2Hub.json` | Contract artifacts, copied as-is like every other ABI in `abi/`. See §4 for the diamond caveat. |
| Contracts | `libs/contracts/src/constants.ts`, `definitions.ts` | Addresses for every network, non-optional; `ZERO_ADDRESS` as the placeholder on Flare |
| Constants | `libs/fsp-rewards/src/constants.ts` | `FCC_FEES_ADDRESS` (Songbird `0x3390E1aDf46568cCC95c3571424937b042094ac2`, Flare `0x2168DB7275C49Af8dBEb11c1298d9e3C0e2a3041`, test networks `0x…dEaD`), `FCC_ACTIVATION_REWARD_EPOCH`, `FCC_FAR_FUTURE_REWARD_EPOCH`, `isFccActive` |
| Events | `libs/contracts/src/events/TeeInstructionsSent.ts`, `Fdc2AttestationRequested.ts` | Decoding |
| Indexing | `libs/fsp-rewards/src/IndexerClientForRewarding.ts` | `getTeeInstructionsSentEvents`, `getFdc2AttestationRequestedEvents`, bucketed per voting round |
| Data | `libs/fsp-rewards/src/DataManagerForRewarding.ts` | `getFCCDataForVotingRoundRange`, persisted as `fccData` on the reward calculation data |
| Claims | `libs/fsp-rewards/src/reward-calculation/fcc/fcc-fee-claims.ts` | Two tagged `DIRECT` claims to `FCC_FEES_ADDRESS` per voting round |
| Reconciliation | `libs/fsp-rewards/src/reward-calculation/fcc/fcc-reconciliation.ts` | See §3 |

Activation is derived from `isFccActive(rewardEpochId)` at the single point where data collection starts, rather
than added as a command option. It therefore cannot be forgotten on a run, and it stays off the worker-pool option
threading. While FCC is inactive, `fccData` is left undefined, so serialized data for earlier reward epochs stays
byte-identical.

The two fee sources are emitted as **separate tagged claims** (`FCC_TEE_FEES`, `FCC_FDC2_FEES`) so they stay
separable in the partial claim artifacts and exports once the TEE rewarding logic replaces the redirection. They
share a beneficiary and claim type, so `RewardClaim.merge` collapses them into a **single `DIRECT` claim** before
the Merkle tree is built. The FCC protocol tag is deliberately non-numeric (`"FCC"`) so it cannot be mistaken for
the FDC tag (`"200"`) by consumers that filter on it, such as the minimal conditions checks.

## 3. Reconciliation

Written to `<rewardEpochId>/fcc-reconciliation.json` at epoch finalization, and summarised on screen as the **last
thing the reward calculation prints for the epoch**, so whoever runs it sees the outcome without opening the report
or scrolling back through the per-voting-round log:

```
================================================================================================================
FCC FEE ACCOUNTING - reward epoch 5877 - ALL CHECKS PASSED
================================================================================================================
  TEE instruction fees             900000000000000000 wei  0.9
  FDC2 request fees                                 0 wei  0
  observed FCC fees                900000000000000000 wei  0.9
  claimed as FCC fees              900000000000000000 wei  0.9
  voting rounds with FCC activity: 15
  beneficiary: 0x000000000000000000000000000000000000dEaD
----------------------------------------------------------------------------------------------------------------
  [PASS] observed FCC fees are fully claimed: residual 0 wei
  [PASS] final distribution carries at least the FCC fees: ...
  [PASS] every FDC2 request is paired with a TEE instruction: 0 unpaired
  [PASS] reward epoch attribution: 0 TeeInstructionsSent event(s) credited on chain to another reward epoch
  [INFO] all claims vs RewardManager: ... Spans every reward source and excludes staking claims ...
  report: calculations/coston2/5877/fcc-reconciliation.json
================================================================================================================
```

The header reads `ALL CHECKS PASSED` or `N CHECK(S) FAILED`, and on failure every line is emitted through the
logger's error channel with the failing check marked `[FAIL]`. The summary is printed **before** the run throws, so
a failure shows which check failed rather than only a stack trace.

`[PASS]`/`[FAIL]` lines are the hard checks; `[WARN]`/`[INFO]` lines are reported only, for the reasons below.

**Hard failures.** Exact by construction, since the fee events map one to one onto the `receiveRewards` credits and
there is no legitimate rounding source:

- observed FCC fees must equal the FCC claims produced;
- the final reward distribution must assign **at least** that amount to `FCC_FEES_ADDRESS`, tightened to exact
  equality only where that address is used for nothing but FCC fees. On the test networks it is the dead address,
  which is also the burn and FIRE pool address, so the merged `DIRECT` claim for it legitimately carries every
  burned reward too and only a lower bound is assertable. On Songbird and Flare the address is dedicated, so
  equality is required. Either way this catches FCC fees being dropped before the Merkle tree;
- every `AttestationRequested` must have a `TeeInstructionsSent` with the same `instructionId` in the same voting
  round. Both are emitted in the same transaction, so a missing counterpart means events were lost between the
  chain and the indexer. This is the check that catches indexer gaps, which a pure sum cannot.

**Reported, not fatal:**

- the sum of all claims against `RewardManager.getRewardEpochTotals`. **This is expected not to balance on networks
  with P-chain staking, and cannot be made an equality check as it stands.** `ValidatorRewardOffersManager` resolves
  the same `RewardManager` through the address updater and credits the staking inflation to it, but the matching
  staking claims are produced by a different process, not by this one. Measured on Coston2 reward epoch 5877: this
  calculation covered exactly 70% of the epoch's inflation — 35% FTSO scaling and fast updates, 35% FDC — leaving
  the 30% staking share uncovered. It becomes an equality check only once staking claims are accounted for
  alongside these.
- `eventsExcludedByRewardEpochId`: events inside the collection window whose own `rewardEpochId` belongs to a
  neighbouring epoch. These are **expected**, not anomalies — the window deliberately overshoots both boundaries so
  nothing is missed, and the filter removes what belongs elsewhere. The count is reported so boundary activity is
  visible; it must never be a failure condition.

  An earlier revision of this document recommended promoting this to a hard failure, on the basis that it measured
  0 for Coston2 reward epoch 5877. That was a single-epoch sample and it does not generalise: on Coston2 the
  `TeeInstructionsSent` in transaction `0x5083d4ac…`, at exactly `2026-07-25T19:00:00Z`, carries `rewardEpochId`
  5859 while its timestamp falls in the first voting round of 5860. Asserting the count is zero would fail real
  runs. §6 explains why the boundary is defined by `RewardEpochStarted`, not by the voting round schedule.

### Why the on-chain total needs RPC

`epochTotalRewards` cannot be derived from the indexer:

1. `RewardManager.receiveRewards` emits **no event** — it is a pure state mutation, and `IRewardManager` declares
   only `RewardClaimed`, `RewardClaimsExpired` and `RewardClaimsEnabled`.
2. The indexer schema has only `transactions` (top-level), `logs` and `states`. `receiveRewards` is an **internal
   call** from `Fdc2Hub`/`FlareTeeManager` to `RewardManager`, so it never appears in `transactions`.

It is therefore read with a single `eth_call` to `RewardManager.getRewardEpochTotals` over the per-network public
RPC (`RPC_URL()` in `libs/contracts/src/constants.ts`, overridable with the `RPC` env var). This is the only part
of the calculation that touches a node; everything else stays indexer-only. Note that the public nodes cap
`eth_getLogs` at 30 blocks, so they are not a viable source for the events themselves — only for contract state.

An unreachable node is logged rather than treated as an accounting failure, so an environment problem cannot be
confused with a real mismatch.

## 4. Regenerating the ABIs

Both files are plain copies of the compiled contract artifacts, the same way every other ABI in `abi/` is produced;
`sync-v2.sh` has the two `cp` lines.

The one wrinkle is that `FlareTeeManager` is an EIP-2535 diamond. `TeeInstructionsSent` is declared in
`IInstructions.sol` and emitted from a library inlined into `InstructionsFacet`, so it is **absent from the
`FlareTeeManager.sol` artifact**, which carries only `DiamondCut`. The **facet** artifact is therefore copied to
`abi/FlareTeeManager.json` — the diamond's name, which is the name the indexer queries by. As a result the file
internally reports `contractName: "InstructionsFacet"`; nothing reads that field, `AbiCache` keys off the filename
and reads only `.abi`.

Do not "correct" the source path to `contracts/tee/diamond/FlareTeeManager.sol`: the resulting ABI would contain no
matching event. `test/libs/fsp-rewards/fcc-fee-claims.test.ts` pins both `topic0` values, so that mistake fails the
test suite rather than silently producing an event filter that matches nothing.

## 5. Indexer requirements

`scripts/rewards/docker-compose.coston.yaml` and `docker-compose.coston2.yaml` bring up a local indexer configured
for this, and are the quickest way to verify a change against real fee traffic; `coston2-db.sh` then runs the
calculation against it. The settings below are what they encode, and what any other indexer needs.

FSP mode's contract list is **hardcoded and excludes both FCC contracts**, so a stock FSP indexer records no FCC
events at all. Missing events are indistinguishable from no activity, so the accounting would then report a clean
zero while the fees sat unclaimed on the `RewardManager`. Three settings matter:

- **Collect the FCC events.** FSP mode merges user entries with its defaults, and address-only entries need no
  ContractRegistry name, so add two collectors per network:

  ```toml
  [[indexer.collect_logs]]
  contract_address = "0x…" # FlareTeeManager (diamond)
  topic = "0xf770e69a9fc05b7180797556ec4cedb6108ce2c56ffa76c84aa087efeb5e6963" # TeeInstructionsSent

  [[indexer.collect_logs]]
  contract_address = "0x…" # Fdc2Hub (proxy)
  topic = "0x57c4413905bb1b444f93a5eab5a942fae34c0fcaa1c25cc595ce0b990310f5de" # AttestationRequested
  ```

  The topics are event signature hashes and identical on every network; only the addresses differ (see §1). They
  must be collecting **before** the first epoch that accounts for them — the events cannot be backfilled from the
  public RPC, whose `eth_getLogs` is capped far below a useful range.

- **`history_epochs >= 2`.** With `0` the indexer keeps only about fifteen minutes of full blocks, which runs a
  provider but cannot calculate an epoch. `2` serves the current and previous reward epoch. Retention is anchored on
  the oldest served epoch and moves forward as the chain does, so an epoch drops out of range once it is old enough:
  raise this if you need to recalculate further back.

- **`log_range` must not exceed the node's `eth_getLogs` cap.** The public Flare APIs reject anything above 30
  blocks. Above the cap every log request fails into a silent backoff retry, which presents as a stalled sync with
  no error logged — 0% CPU and no progress. Use 30 against the public API and raise it substantially on a dedicated
  node, where the first sync is otherwise slow.

## 6. Why the reconciliation exists

The claim calculation decides how much of the `RewardManager`'s funds each beneficiary receives. If it under-counts
a fee source, nothing else notices: the Merkle tree is still well formed, every claim still verifies, and the
unclaimed remainder simply stays on the contract. The reconciliation is what turns that silent shortfall into a
failed run.

It is not defensive coding in the abstract. Each check exists because of a specific way this can go wrong:

| Check | Failure it catches |
|---|---|
| observed fees == claimed fees | the claim calculation drops or double-counts a fee |
| final distribution carries the fees | claims computed correctly but lost before the Merkle tree |
| every FDC2 request is paired | indexer gap; also the FDC2 fee cannot be attributed without its pair |
| every voting round carries FCC data | a mid-epoch deploy leaving rounds computed by the previous version |

It has already earned this. Running it against real Coston2 data exposed a defect in its own final-distribution
check that twenty-seven fixture tests had missed, because on the test networks `FCC_FEES_ADDRESS` coincides with the
burn address and the merged claim legitimately dwarfs the FCC fees.

The scope is deliberately bounded: it verifies **fee accounting**, not reward correctness, and it lives entirely in
`libs/fsp-rewards/src/reward-calculation/fcc/`. When the TEE rewarding logic replaces the flat redirection to
`FCC_FEES_ADDRESS`, this directory goes with it.

## 7. Verified against Coston2 reward epoch 5877

`fcc-reconciliation.json` for that epoch:

| Field | Value |
|---|---|
| `observedFeesWei` | `900000000000000000` (0.9 C2FLR, all TEE; the FDC2 requests fell in epoch 5876) |
| `claimedFeesWei` | `900000000000000000` |
| `residualWei` | `0` |
| `unpairedFdc2Requests` | `0` |
| `votingRoundsWithFccActivity` | `15` |

The independent confirmation is that `RewardManager.getRewardEpochTotals(5877)` reports a total of
`3472225.122222` and an inflation of `3472222.222222`, so the epoch's **non-inflation** funds are exactly
**2.9 C2FLR**. The legacy FDC fees account for 2.0 of that and this FCC accounting for the other 0.9 — matching to
the wei, from a source independent of the events being decoded.

This run also established something fixtures could not: the FCC fees must not be required to *equal* the final
`DIRECT` claim for `FCC_FEES_ADDRESS`. On every test network that address is the dead address, which is also the
burn and FIRE pool address, so the merged claim legitimately carried 349255.82 C2FLR against 0.9 C2FLR of fees. The
check is a lower bound, tightened to equality only where the address is exclusive to FCC. See §3.
