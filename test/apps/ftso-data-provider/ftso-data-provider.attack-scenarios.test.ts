/**
 * Adversarial scenarios for FtsoDataProviderService.
 *
 * Each test runs one voting round end-to-end against an in-process
 * SQLite indexer DB. Voter index 0 emits adversarial bytes via
 * hand-crafted transactions (bypassing the live service for that voter
 * only). Voters 1..N-1 use the real service. Assertions check the
 * round result computed by each honest voter.
 *
 * Invariants:
 *   - All honest voters must compute the same merkleRoot (consensus).
 *   - isSecureRandom = false ⟺ at least one provider is newly benched
 *     in this round (per FSP Anchor.md "Round Random Number").
 */

import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import FakeTimers from "@sinonjs/fake-timers";
import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import * as chai from "chai";
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";

import { IConfig } from "../../../apps/ftso-data-provider/src/config/configuration";
import { FtsoDataProviderService } from "../../../apps/ftso-data-provider/src/ftso-data-provider.service";
import {
  encodeCommitPayloadMessage,
  encodeRevealPayloadMessage,
} from "../../../apps/ftso-data-provider/src/response-encoders";
import { AbiCache } from "../../../libs/contracts/src/abi/AbiCache";
import { CONTRACTS } from "../../../libs/contracts/src/constants";
import { ContractMethodNames } from "../../../libs/contracts/src/definitions";
import { EPOCH_SETTINGS, FTSO2_PROTOCOL_ID } from "../../../libs/ftso-core/src/constants";
import { CommitData } from "../../../libs/ftso-core/src/data/CommitData";
import { FeedValueEncoder } from "../../../libs/ftso-core/src/data/FeedValueEncoder";
import { PayloadMessage } from "../../../libs/ftso-core/src/fsp-utils/PayloadMessage";
import { TLPTransaction } from "../../../libs/ftso-core/src/orm/entities";
import { unPrefix0x } from "../../../libs/ftso-core/src/utils/encoding";
import { Feed } from "../../../libs/ftso-core/src/voting-types";
import { TestVoter, generateTx, generateVoters } from "../../utils/basic-generators";
import { MockIndexerDB } from "../../utils/db";
import { currentTimeSec, generateRewardEpochEvents, toFeedId } from "../../utils/generators";
import { getTestFile } from "../../utils/getTestFile";

chai.use(chaiAsPromised);

const testFeeds: Feed[] = [
  { id: toFeedId("BTC/USD", true), decimals: 2 },
  { id: toFeedId("ETH/USD", true), decimals: 2 },
  { id: toFeedId("FRL/USD", true), decimals: 5 },
];

describe(`ftso-data-provider.service attack scenarios (${getTestFile(__filename)})`, () => {
  const HONEST_VALUES = [38573.26, 2175.12, 0.02042];
  const NONZERO_RANDOM = "0x" + "ab".repeat(32);
  const WRONG_RANDOM = "0x" + "11".repeat(32);
  const offerCount = 2;

  const enc = AbiCache.instance;
  const sigCommit = enc.getFunctionSignature(CONTRACTS.Submission.name, ContractMethodNames.submit1);
  const sigReveal = enc.getFunctionSignature(CONTRACTS.Submission.name, ContractMethodNames.submit2);

  const configValues: IConfig = {
    required_indexer_history_time_sec: 1000,
    indexer_top_timeout: 1000,
    voting_round_history_size: 10000,
    value_provider_url: "http://localhost:3000",
    port: -1,
    db_host: "",
    db_name: "",
    db_user: "",
    db_pass: "",
    db_port: -1,
    api_keys: [],
  };
  const configService = new ConfigService(configValues);

  let db: MockIndexerDB;
  let clock: FakeTimers.InstalledClock;
  let mock: MockAdapter;

  // Cross-test pins. Set by a "baseline" test, read by its companion to compare
  // merkle roots. Both companions live in the same describe so test order is stable.
  let b4WrongSenderRoot: string | undefined;
  let c1HonestBaselineRoot: string | undefined;

  before(() => {
    Logger.overrideLogger(false);
  });
  after(() => {
    Logger.overrideLogger(new Logger());
  });

  beforeEach(async () => {
    db = await MockIndexerDB.create();
    clock = FakeTimers.install({ now: EPOCH_SETTINGS().expectedRewardEpochStartTimeSec(0) * 1000 });
    mock = new MockAdapter(axios);
  });

  afterEach(async () => {
    await db.close();
    clock.uninstall();
    mock.restore();
  });

  // ──────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────

  /** Standard happy-path encoding of HONEST_VALUES into the on-wire hex string. */
  function honestEncodedValues(): string {
    return FeedValueEncoder.encode(HONEST_VALUES, testFeeds, false);
  }

  /** Build a commit tx whose hash matches the (random, encodedValues) pair. */
  function buildCommitTx(
    voter: TestVoter,
    round: number,
    random: string,
    encodedValues: string,
    blockNo: number,
    timestamp: number,
    opts: { fromAddress?: string } = {}
  ): TLPTransaction {
    const commitHash = CommitData.hashForCommit(voter.submitAddress, round, random, encodedValues);
    const msg = encodeCommitPayloadMessage({
      protocolId: FTSO2_PROTOCOL_ID,
      votingRoundId: round,
      payload: { commitHash },
    });
    return generateTx(
      opts.fromAddress ?? voter.submitAddress,
      CONTRACTS.Submission.address,
      sigCommit,
      blockNo,
      timestamp,
      sigCommit + unPrefix0x(msg)
    );
  }

  /** Build a reveal tx with arbitrary (random, encodedValues). May not match commit. */
  function buildRevealTx(
    voter: TestVoter,
    round: number,
    random: string,
    encodedValues: string,
    blockNo: number,
    timestamp: number,
    opts: { fromAddress?: string } = {}
  ): TLPTransaction {
    const msg = encodeRevealPayloadMessage({
      protocolId: FTSO2_PROTOCOL_ID,
      votingRoundId: round,
      payload: { random, feeds: [], encodedValues },
    });
    return generateTx(
      opts.fromAddress ?? voter.submitAddress,
      CONTRACTS.Submission.address,
      sigReveal,
      blockNo,
      timestamp,
      sigReveal + unPrefix0x(msg)
    );
  }

  /**
   * Build a commit tx with a raw payload + arbitrary protocolId. The typed
   * encoders over-constrain — CommitData.encode rejects non-32-byte hex, so
   * tests that need malformed payloads or non-FTSO protocol ids go through here.
   */
  function buildCommitTxRaw(
    voter: TestVoter,
    protocolId: number,
    round: number,
    rawPayload: string,
    blockNo: number,
    timestamp: number
  ): TLPTransaction {
    const msg = PayloadMessage.encode({
      protocolId,
      votingRoundId: round,
      payload: rawPayload,
    });
    return generateTx(
      voter.submitAddress,
      CONTRACTS.Submission.address,
      sigCommit,
      blockNo,
      timestamp,
      sigCommit + unPrefix0x(msg)
    );
  }

  /** Build a reveal tx with an arbitrary protocolId (otherwise honest payload). */
  function buildRevealTxWithProtocolId(
    voter: TestVoter,
    protocolId: number,
    round: number,
    random: string,
    encodedValues: string,
    blockNo: number,
    timestamp: number
  ): TLPTransaction {
    const msg = encodeRevealPayloadMessage({
      protocolId,
      votingRoundId: round,
      payload: { random, feeds: [], encodedValues },
    });
    return generateTx(
      voter.submitAddress,
      CONTRACTS.Submission.address,
      sigReveal,
      blockNo,
      timestamp,
      sigReveal + unPrefix0x(msg)
    );
  }

  async function setUpRewardEpoch(rewardEpochId: number, voters: TestVoter[]) {
    const events = generateRewardEpochEvents(EPOCH_SETTINGS(), testFeeds, offerCount, rewardEpochId, voters);
    await db.addEvent(events);
    clock.setSystemTime(EPOCH_SETTINGS().expectedRewardEpochStartTimeSec(rewardEpochId) * 1000 + 1);
    await db.syncTimeToNow();
  }

  /**
   * Run one voting round with voters[0] = malicious (use makeBadCommit /
   * makeBadReveal) and voters[1..] = honest (real service). Returns the
   * IProtocolMessageMerkleRoot computed by each honest voter.
   */
  async function runAttackRound(
    voters: TestVoter[],
    makeBadCommit: (round: number, blockNo: number, ts: number) => TLPTransaction[],
    makeBadReveal: (round: number, blockNo: number, ts: number) => TLPTransaction[]
  ) {
    const rewardEpochId = 1;
    await setUpRewardEpoch(rewardEpochId, voters);
    mock.onPost(/feed-values/).reply(200, {
      votingRoundId: 1,
      data: testFeeds.map((_, i) => ({ value: HONEST_VALUES[i] })),
    });

    const honest = voters.slice(1);
    const services = honest.map(() => new FtsoDataProviderService(db.em, configService));
    const round = EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpochId);

    clock.tick(1000);
    await db.addTransaction(makeBadCommit(round, 1, currentTimeSec()));
    for (let i = 0; i < honest.length; i++) {
      const encoded = encodeCommitPayloadMessage(await services[i].getCommitData(round, honest[i].submitAddress));
      await db.addTransaction([
        generateTx(
          honest[i].submitAddress,
          CONTRACTS.Submission.address,
          sigCommit,
          1,
          currentTimeSec(),
          sigCommit + unPrefix0x(encoded)
        ),
      ]);
    }

    clock.tick(EPOCH_SETTINGS().votingEpochDurationSeconds * 1000);
    await db.addTransaction(makeBadReveal(round, 2, currentTimeSec()));
    for (let i = 0; i < honest.length; i++) {
      const encoded = encodeRevealPayloadMessage(services[i].getRevealData(round, honest[i].submitAddress));
      await db.addTransaction([
        generateTx(
          honest[i].submitAddress,
          CONTRACTS.Submission.address,
          sigReveal,
          2,
          currentTimeSec(),
          sigReveal + unPrefix0x(encoded)
        ),
      ]);
    }

    clock.tick(EPOCH_SETTINGS().revealDeadlineSeconds * 1000 + 1);
    await db.syncTimeToNow();
    return Promise.all(services.map((s) => s.getResultData(round)));
  }

  // ──────────────────────────────────────────────────────────────────
  // A — value-level attacks (outliers, malformed payloads, timing)
  // ──────────────────────────────────────────────────────────────────

  // Voter 0 commits + reveals 0xffffffff per feed slot (INT32_MAX under
  // excess-2^31). With 1-of-10 weight the weighted median must hold.
  it("A2 extreme_high_values: single-voter INT32_MAX outlier", async () => {
    const voters = generateVoters(10);
    const extreme = "0x" + "ffffffff".repeat(testFeeds.length);
    const results = await runAttackRound(
      voters,
      (round, b, ts) => [buildCommitTx(voters[0], round, NONZERO_RANDOM, extreme, b, ts)],
      (round, b, ts) => [buildRevealTx(voters[0], round, NONZERO_RANDOM, extreme, b, ts)]
    );
    const roots = new Set(results.map((r) => r.merkleRoot));
    expect(roots.size, "honest voters disagree").to.equal(1);
    expect(results[0].isSecureRandom).to.equal(true);
  });

  // Mirror of A2 on the low end (0x00000000 → INT32_MIN).
  it("A3 extreme_low_values: single-voter INT32_MIN outlier", async () => {
    const voters = generateVoters(10);
    const extreme = "0x" + "00000000".repeat(testFeeds.length);
    const results = await runAttackRound(
      voters,
      (round, b, ts) => [buildCommitTx(voters[0], round, NONZERO_RANDOM, extreme, b, ts)],
      (round, b, ts) => [buildRevealTx(voters[0], round, NONZERO_RANDOM, extreme, b, ts)]
    );
    const roots = new Set(results.map((r) => r.merkleRoot));
    expect(roots.size, "honest voters disagree").to.equal(1);
    expect(results[0].isSecureRandom).to.equal(true);
  });

  // Honest commit, mutated reveal — hash(reveal) ≠ commitHash → voter is treated
  // as a reveal-offender and benched. Distinct from "no reveal at all".
  it("A4 mismatched_reveal: honest commit, mutated reveal", async () => {
    const voters = generateVoters(10);
    const honestEnc = honestEncodedValues();
    const flippedEnc =
      "0x" + (parseInt(honestEnc.slice(2, 10), 16) ^ 0xffffffff).toString(16).padStart(8, "0") + honestEnc.slice(10);

    const results = await runAttackRound(
      voters,
      (round, b, ts) => [buildCommitTx(voters[0], round, NONZERO_RANDOM, honestEnc, b, ts)],
      (round, b, ts) => [buildRevealTx(voters[0], round, NONZERO_RANDOM, flippedEnc, b, ts)]
    );
    const roots = new Set(results.map((r) => r.merkleRoot));
    expect(roots.size, "honest voters disagree on root").to.equal(1);
    expect(results[0].isSecureRandom).to.equal(false);
  });

  // Voter 0 commits honestly but reveals AFTER the reveal deadline.
  // DataManager.filterRevealsByDeadlineTime drops it → reveal-offender.
  it("A5 late_reveal: reveal after deadline is dropped", async () => {
    const voters = generateVoters(10);
    const honestEnc = honestEncodedValues();
    const round = EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(1);
    const lateRevealTs = EPOCH_SETTINGS().revealDeadlineSec(round + 1) + 1;
    const results = await runAttackRound(
      voters,
      (r, b, ts) => [buildCommitTx(voters[0], r, NONZERO_RANDOM, honestEnc, b, ts)],
      (r, b) => [buildRevealTx(voters[0], r, NONZERO_RANDOM, honestEnc, b, lateRevealTs)]
    );
    const roots = new Set(results.map((r) => r.merkleRoot));
    expect(roots.size, "honest voters disagree").to.equal(1);
    expect(results[0].isSecureRandom).to.equal(false);
  });

  // feedValues hex length not divisible by 8 → FeedValueEncoder.decode throws.
  // Honest service must catch this per-voter (no DoS) and bench voter 0.
  it("A7 non_8_multiple_reveal: malformed-length feedValues", async () => {
    const voters = generateVoters(10);
    const malformedEnc = "0x" + "ffffffff".repeat(testFeeds.length) + "abc";
    const results = await runAttackRound(
      voters,
      (round, b, ts) => [buildCommitTx(voters[0], round, NONZERO_RANDOM, malformedEnc, b, ts)],
      (round, b, ts) => [buildRevealTx(voters[0], round, NONZERO_RANDOM, malformedEnc, b, ts)]
    );
    const roots = new Set(results.map((r) => r.merkleRoot));
    expect(roots.size, "honest voters disagree").to.equal(1);
    expect(results[0].isSecureRandom).to.equal(false);
  });

  // Commit + reveal carry protocolId=200. getVoterToLastCommitMap /
  // getVoterToLastRevealMap filter on FTSO2_PROTOCOL_ID, so voter 0
  // contributes nothing. Pins a check that's currently silent (no warn log).
  it("A8 wrong_protocol_id: commit + reveal with protocolId=200 are dropped", async () => {
    const voters = generateVoters(10);
    const honestEnc = honestEncodedValues();
    const commitHash = (round: number) =>
      CommitData.hashForCommit(voters[0].submitAddress, round, NONZERO_RANDOM, honestEnc);
    const results = await runAttackRound(
      voters,
      (round, b, ts) => [buildCommitTxRaw(voters[0], 200, round, commitHash(round), b, ts)],
      (round, b, ts) => [buildRevealTxWithProtocolId(voters[0], 200, round, NONZERO_RANDOM, honestEnc, b, ts)]
    );
    const roots = new Set(results.map((r) => r.merkleRoot));
    expect(roots.size, "honest voters disagree").to.equal(1);
    // No newly benched provider this round (voter 0 simply isn't present).
    expect(results[0].isSecureRandom).to.equal(true);
  });

  // Commit payload is shorter than a 32-byte hash → CommitData.decode throws.
  // The try/catch in getVoterToLastCommitMap must log and continue. Voter 0's
  // (otherwise honest) reveal then lands in eligibleReveals without a matching
  // commit and is discarded by getValidReveals — voter 0 contributes nothing.
  it("A9 unparseable_commit_payload: short hex payload is logged and skipped", async () => {
    const voters = generateVoters(10);
    const honestEnc = honestEncodedValues();
    const results = await runAttackRound(
      voters,
      (round, b, ts) => [buildCommitTxRaw(voters[0], FTSO2_PROTOCOL_ID, round, "0x1234", b, ts)],
      (round, b, ts) => [buildRevealTx(voters[0], round, NONZERO_RANDOM, honestEnc, b, ts)]
    );
    const roots = new Set(results.map((r) => r.merkleRoot));
    expect(roots.size, "honest voters disagree").to.equal(1);
    expect(results[0].isSecureRandom).to.equal(true);
  });

  // ──────────────────────────────────────────────────────────────────
  // B — submission-layer attacks (duplicates, sender filtering)
  // ──────────────────────────────────────────────────────────────────

  // Two commit txs in the same round. Per spec the last submission wins per
  // protocolId, so voter 0's reveal must match the second commit's hash.
  it("B1 multiple_commits_same_round: last commit wins", async () => {
    const voters = generateVoters(10);
    const honestEnc = honestEncodedValues();
    const results = await runAttackRound(
      voters,
      (round, b, ts) => [
        buildCommitTx(voters[0], round, WRONG_RANDOM, honestEnc, b, ts),
        buildCommitTx(voters[0], round, NONZERO_RANDOM, honestEnc, b + 1, ts + 1),
      ],
      (round, b, ts) => [buildRevealTx(voters[0], round, NONZERO_RANDOM, honestEnc, b, ts)]
    );
    const roots = new Set(results.map((r) => r.merkleRoot));
    expect(roots.size, "honest voters disagree").to.equal(1);
    expect(results[0].isSecureRandom).to.equal(true);
  });

  // One submit1 tx whose calldata concatenates TWO PayloadMessages for the same
  // protocolId. Spec says only the last is considered.
  it("B2 multi_message_payload: two PayloadMessages, last wins", async () => {
    const voters = generateVoters(10);
    const honestEnc = honestEncodedValues();
    const round = EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(1);
    const goodHash = CommitData.hashForCommit(voters[0].submitAddress, round, NONZERO_RANDOM, honestEnc);
    const badHash = CommitData.hashForCommit(voters[0].submitAddress, round, WRONG_RANDOM, honestEnc);

    const results = await runAttackRound(
      voters,
      (round, b, ts) => {
        const msg1 = encodeCommitPayloadMessage({
          protocolId: FTSO2_PROTOCOL_ID,
          votingRoundId: round,
          payload: { commitHash: badHash },
        });
        const msg2 = encodeCommitPayloadMessage({
          protocolId: FTSO2_PROTOCOL_ID,
          votingRoundId: round,
          payload: { commitHash: goodHash },
        });
        const concat = msg1 + unPrefix0x(msg2);
        return [
          generateTx(
            voters[0].submitAddress,
            CONTRACTS.Submission.address,
            sigCommit,
            b,
            ts,
            sigCommit + unPrefix0x(concat)
          ),
        ];
      },
      (round, b, ts) => [buildRevealTx(voters[0], round, NONZERO_RANDOM, honestEnc, b, ts)]
    );
    const roots = new Set(results.map((r) => r.merkleRoot));
    expect(roots.size, "honest voters disagree").to.equal(1);
    expect(results[0].isSecureRandom).to.equal(true);
  });

  // Companion to B1 for the reveal side. First reveal has a wrong random; the
  // second matches the commit. Last-wins semantics → voter 0 included.
  it("B3 multiple_reveals_same_round: last reveal wins", async () => {
    const voters = generateVoters(10);
    const honestEnc = honestEncodedValues();
    const results = await runAttackRound(
      voters,
      (round, b, ts) => [buildCommitTx(voters[0], round, NONZERO_RANDOM, honestEnc, b, ts)],
      (round, b, ts) => [
        buildRevealTx(voters[0], round, WRONG_RANDOM, honestEnc, b, ts),
        buildRevealTx(voters[0], round, NONZERO_RANDOM, honestEnc, b + 1, ts + 1),
      ]
    );
    const roots = new Set(results.map((r) => r.merkleRoot));
    expect(roots.size, "honest voters disagree").to.equal(1);
    expect(results[0].isSecureRandom).to.equal(true);
  });

  // Voter 0 submits commit + reveal from signingAddress instead of submitAddress.
  // The on-chain Submission contract rejects this; the data-provider's reading
  // layer does NOT. The exclusion-baseline companion proves the wrong-sender
  // data was included by showing the roots differ from a run where voter 0
  // sends nothing.
  //
  // generateVoters(N) is deterministic across both tests, so the voter set,
  // reward-epoch events, and honest-voter behaviour are identical between the
  // two runs — the only difference is voter 0's transactions.
  it("B4 commit_from_signing_addr: wrong sender NOT filtered (vote is accepted)", async () => {
    const voters = generateVoters(10);
    const honestEnc = honestEncodedValues();
    const results = await runAttackRound(
      voters,
      (round, b, ts) => [
        buildCommitTx(voters[0], round, NONZERO_RANDOM, honestEnc, b, ts, {
          fromAddress: voters[0].signingAddress,
        }),
      ],
      (round, b, ts) => [
        buildRevealTx(voters[0], round, NONZERO_RANDOM, honestEnc, b, ts, {
          fromAddress: voters[0].signingAddress,
        }),
      ]
    );
    const roots = new Set(results.map((r) => r.merkleRoot));
    expect(roots.size, "honest voters disagree on wrong-sender root").to.equal(1);
    expect(results[0].isSecureRandom).to.equal(true);
    b4WrongSenderRoot = [...roots][0];
  });

  it("B4 exclusion baseline: voter 0 absent → root differs from wrong-sender root", async () => {
    const voters = generateVoters(10);
    const results = await runAttackRound(
      voters,
      () => [],
      () => []
    );
    const roots = new Set(results.map((r) => r.merkleRoot));
    expect(roots.size, "honest voters disagree on baseline").to.equal(1);
    expect(b4WrongSenderRoot, "B4 wrong-sender test must run before the exclusion baseline").to.not.be.undefined;
    expect([...roots][0], "voter 0's wrong-sender data was unexpectedly filtered out").to.not.equal(b4WrongSenderRoot);
  });

  // Companion to B4 isolating the reveal side. Voter 0 commits honestly from
  // submitAddress but reveals from signingAddress. The reveal map is keyed by
  // tx sender, so the reveal lands under signingAddress and is invisible to
  // the commit → reveal-offender → benched.
  it("B5 reveal_from_signing_addr: commit honest, reveal from wrong sender → benched", async () => {
    const voters = generateVoters(10);
    const honestEnc = honestEncodedValues();
    const results = await runAttackRound(
      voters,
      (round, b, ts) => [buildCommitTx(voters[0], round, NONZERO_RANDOM, honestEnc, b, ts)],
      (round, b, ts) => [
        buildRevealTx(voters[0], round, NONZERO_RANDOM, honestEnc, b, ts, {
          fromAddress: voters[0].signingAddress,
        }),
      ]
    );
    const roots = new Set(results.map((r) => r.merkleRoot));
    expect(roots.size, "honest voters disagree").to.equal(1);
    expect(results[0].isSecureRandom).to.equal(false);
  });

  // ──────────────────────────────────────────────────────────────────
  // C — leaf-encoding invariants
  // ──────────────────────────────────────────────────────────────────

  // A low-weight INT32_MAX outlier does not change the final median (9 honest
  // voters of equal weight pin it), but it DOES change the merkle root,
  // because the leaf encoding includes quartile3 and participatingWeight and
  // both shift when the outlier is included. The baseline pins the no-outlier
  // root; the outlier test asserts the roots differ. A future refactor that
  // drops Q3 or weight from the leaf encoding will flip the inequality and
  // fail this test.
  it("C1 honest-voter-only baseline: voter 0 submits HONEST_VALUES like everyone else", async () => {
    const voters = generateVoters(10);
    const honestEnc = honestEncodedValues();
    const results = await runAttackRound(
      voters,
      (round, b, ts) => [buildCommitTx(voters[0], round, NONZERO_RANDOM, honestEnc, b, ts)],
      (round, b, ts) => [buildRevealTx(voters[0], round, NONZERO_RANDOM, honestEnc, b, ts)]
    );
    const roots = new Set(results.map((r) => r.merkleRoot));
    expect(roots.size, "honest voters disagree on baseline root").to.equal(1);
    expect(results[0].isSecureRandom).to.equal(true);
    c1HonestBaselineRoot = [...roots][0];
  });

  it("C1 outlier_changes_quartile_not_consensus: INT32_MAX outlier shifts merkle root via Q3/weight", async () => {
    const voters = generateVoters(10);
    const extreme = "0x" + "ffffffff".repeat(testFeeds.length);
    const results = await runAttackRound(
      voters,
      (round, b, ts) => [buildCommitTx(voters[0], round, NONZERO_RANDOM, extreme, b, ts)],
      (round, b, ts) => [buildRevealTx(voters[0], round, NONZERO_RANDOM, extreme, b, ts)]
    );
    const roots = new Set(results.map((r) => r.merkleRoot));
    expect(roots.size, "honest voters disagree on outlier-round root").to.equal(1);
    expect(results[0].isSecureRandom).to.equal(true);
    expect(c1HonestBaselineRoot, "C1 baseline test must run before this one").to.not.be.undefined;
    expect([...roots][0], "outlier no longer affects merkle root — Q3/weight may have been dropped").to.not.equal(
      c1HonestBaselineRoot
    );
  });

  // ──────────────────────────────────────────────────────────────────
  // F — feed-value provider behaviour
  // ──────────────────────────────────────────────────────────────────

  // Feed-value provider returns a value that, after applying decimals, exceeds
  // INT32 range. FeedValueEncoder.encode throws — the data-provider must surface
  // this loudly rather than submit corrupted bytes.
  it("F3 feed_value_provider_value_out_of_range: encode rejects overflow", async () => {
    const voters = generateVoters(1);
    const rewardEpochId = 1;
    await setUpRewardEpoch(rewardEpochId, voters);
    // 5e10 × 10^2 = 5e12 ≫ 2^31
    mock.onPost(/feed-values/).reply(200, {
      votingRoundId: 1,
      data: testFeeds.map(() => ({ value: 5e10 })),
    });

    const service = new FtsoDataProviderService(db.em, configService);
    const round = EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpochId);

    await expect(service.getCommitData(round, voters[0].submitAddress)).to.eventually.be.rejected;
  });
});
