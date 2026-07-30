# FCC — TEE and FDC2 fee accounting

This document records how the fees of the Flare Confidential Compute (FCC) contracts are accounted for in the
reward calculation.

> **Status:** implemented, gated by `FCC_ACTIVATION_REWARD_EPOCH` alone. Active on Songbird from reward epoch
> **419**, and on Coston and Coston2 from reward epoch **5877**. On Flare the activation epoch is
> `FCC_FAR_FUTURE_REWARD_EPOCH`, so FCC fees are not accounted for there yet.

## 1. Where the funds come from

Two contracts were added by the `tee_deploy` branch of `flare-smart-contracts-v2`:

| Network | `FlareTeeManager` | `Fdc2Hub` | Activation epoch |
|---|---|---|---|
| Songbird | `0x5C2dE0DeFC3FDBbF8e12c12bD0b1629Ed37DC767` | `0x4234a8f5D255d91d56df53d0cc78c0Cc2B67ACD8` | 419 |
| Coston | `0xc4885998f5D792ed88C5Af7a3AaCBe333f017658` | `0x064C7B68B0e2BC87e7bE34e89741485Fcb48FA2F` | 5877 |
| Coston2 | `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE` | `0x04dd3Ba33aC798d400bEc42A26F82f9812A421dc` | 5877 |
| Flare | placeholder | placeholder | `FCC_FAR_FUTURE_REWARD_EPOCH` |

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

Written to `<rewardEpochId>/fcc-reconciliation.json` at epoch finalization.

**Hard failures.** Exact by construction, since the fee events map one to one onto the `receiveRewards` credits and
there is no legitimate rounding source:

- observed FCC fees must equal the FCC claims produced;
- the final reward distribution must assign exactly that amount to `FCC_FEES_ADDRESS`;
- every `AttestationRequested` must have a `TeeInstructionsSent` with the same `instructionId` in the same voting
  round. Both are emitted in the same transaction, so a missing counterpart means events were lost between the
  chain and the indexer. This is the check that catches indexer gaps, which a pure sum cannot.

**Reported, not fatal:**

- the sum of all claims against `RewardManager.getRewardEpochTotals`. This spans every reward source, not just FCC,
  so a pre-existing discrepancy in a legacy source must not block an epoch. Promote to fatal once observed clean.
- `TeeInstructionsSent` events whose own `rewardEpochId` differs from the epoch they were bucketed into. The event
  carries the very epoch id `RewardManager` credited, so a non-zero count means funds credited on chain to one
  epoch are claimed in another. Voting round boundaries and the on-chain epoch switch are expected to coincide;
  this counter proves it on real data before the check is promoted to a hard failure.

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
