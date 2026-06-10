import { expect } from "chai";
import { DataManager } from "../../../libs/ftso-core/src/DataManager";
import { ICommitData } from "../../../libs/ftso-core/src/data/CommitData";
import { IRevealData } from "../../../libs/ftso-core/src/data/RevealData";
import { formatSubmissionsForLog, payloadPreview } from "../../../libs/ftso-core/src/utils/log-format";
import { SubmissionData } from "../../../libs/ftso-core/src/IndexerClient";
import { emptyLogger } from "../../../libs/ftso-core/src/utils/ILogger";

/**
 * LOW-04 regression tests.
 *
 * Reveal/commit submission payloads contain attacker-controllable hex calldata
 * of unbounded size. The fix replaces every full-payload log (`JSON.stringify`
 * at debug, the raw payload at warn) with a short, log-safe summary that is
 * always emitted regardless of log level. These tests cover the summary
 * helpers, which are the only pieces that need guarding.
 */
describe("DataManager - LOW-04 log truncation", () => {
  const OVERSIZED_HEX = "0x" + "ab".repeat(2048); // 4098 chars of hex

  function makeSubmission(payload: string): SubmissionData {
    return {
      submitAddress: "0x0000000000000000000000000000000000000001",
      votingEpochIdFromTimestamp: 1,
      relativeTimestamp: 0,
      blockNumber: 1,
      timestamp: 0,
      transactionIndex: 0,
      messages: [
        {
          protocolId: 100,
          votingRoundId: 1,
          payload,
        },
      ],
    };
  }

  describe("payloadPreview", () => {
    it("truncates an oversized payload and reports its length", () => {
      const preview = payloadPreview(OVERSIZED_HEX);
      expect(preview).to.not.include(OVERSIZED_HEX);
      expect(preview).to.include(OVERSIZED_HEX.slice(0, 18));
      expect(preview).to.include("4098 chars");
      expect(preview.length).to.be.lessThan(60);
    });

    it("returns <none> for a non-string payload", () => {
      expect(payloadPreview(undefined)).to.equal("<none>");
      expect(payloadPreview(null)).to.equal("<none>");
    });
  });

  describe("formatSubmissionsForLog", () => {
    it("returns count=0 for an empty array", () => {
      expect(formatSubmissionsForLog([])).to.equal("count=0");
    });

    it("does not include the full oversized payload bytes", () => {
      const summary = formatSubmissionsForLog([makeSubmission(OVERSIZED_HEX)]);
      expect(summary).to.not.include(OVERSIZED_HEX);
      // The summary must not leak a long tail of attacker bytes either.
      expect(summary.length).to.be.lessThan(120);
    });

    it("includes a short prefix of the first payload and a count", () => {
      const summary = formatSubmissionsForLog([makeSubmission(OVERSIZED_HEX), makeSubmission(OVERSIZED_HEX)]);
      expect(summary).to.include("count=2");
      // 0x + 16 hex chars = 18-char prefix
      expect(summary).to.include(OVERSIZED_HEX.slice(0, 18));
    });

    it("tolerates a submission with no messages", () => {
      const submission: SubmissionData = {
        submitAddress: "0x0000000000000000000000000000000000000001",
        votingEpochIdFromTimestamp: 1,
        relativeTimestamp: 0,
        blockNumber: 1,
        timestamp: 0,
        transactionIndex: 0,
        messages: [],
      };
      const summary = formatSubmissionsForLog([submission]);
      expect(summary).to.include("count=1");
      expect(summary).to.include("<none>");
    });
  });
});

describe("DataManager - reveal hash hardening", () => {
  // Defense in depth for the empty-reveal round halt: a reveal whose random cannot be hashed as a uint256
  // (e.g. "0x", should it ever bypass RevealData.decode) must not throw out of getValidReveals/getRevealOffenders
  // and abort the whole round; it is treated as an invalid reveal.
  const voter = "0x0000000000000000000000000000000000000001";
  const commits = new Map<string, ICommitData>([[voter, { commitHash: "0x" + "00".repeat(32) }]]);
  const reveals = new Map<string, IRevealData>([[voter, { random: "0x", feeds: [], encodedValues: "0x" }]]);
  // getValidReveals/getRevealOffenders only use the logger, so the other dependencies are not needed here.
  // The protected methods are exposed via a typed cast so their return types are preserved.
  const dataManager = new DataManager(undefined, undefined, emptyLogger) as unknown as {
    getValidReveals(
      votingRoundId: number,
      commits: Map<string, ICommitData>,
      reveals: Map<string, IRevealData>
    ): Map<string, IRevealData>;
    getRevealOffenders(
      votingRoundId: number,
      commits: Map<string, ICommitData>,
      reveals: Map<string, IRevealData>
    ): Set<string>;
  };

  it("excludes an un-hashable reveal from valid reveals instead of throwing", () => {
    let valid: Map<string, IRevealData> | undefined;
    expect(() => (valid = dataManager.getValidReveals(1, commits, reveals))).to.not.throw();
    expect(valid?.has(voter)).to.eq(false);
  });

  it("counts an un-hashable reveal as a reveal offender instead of throwing", () => {
    let offenders: Set<string> | undefined;
    expect(() => (offenders = dataManager.getRevealOffenders(1, commits, reveals))).to.not.throw();
    expect(offenders?.has(voter)).to.eq(true);
  });
});
