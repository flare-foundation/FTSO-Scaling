import { expect } from "chai";
import { formatSubmissionsForLog } from "../../../libs/ftso-core/src/DataManager";
import { SubmissionData } from "../../../libs/ftso-core/src/IndexerClient";

/**
 * LOW-04 regression tests.
 *
 * Reveal/commit submission payloads contain attacker-controllable hex calldata
 * of unbounded size. The fix replaces `JSON.stringify(submissions)` at debug
 * level with a short, log-safe summary, and gates full payloads behind the
 * `.verbose` logger level. These tests cover the summary helper directly,
 * which is the only piece that needs guarding.
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

  describe("Logger-level routing contract", () => {
    /**
     * Documents the policy the production code follows:
     *   - `.debug(...)` receives only the truncated summary, never raw payload bytes.
     *   - `.verbose(...)` (optional) receives the full JSON-stringified payload.
     *
     * The DataManager call site uses `formatSubmissionsForLog` for `.debug` and
     * `JSON.stringify` for `.verbose?.(...)`. This test simulates the exact
     * dispatch on a fake logger and asserts the routing.
     */
    interface LogRecord {
      level: "log" | "error" | "warn" | "debug" | "verbose";
      message: string;
    }

    function toMessage(value: unknown): string {
      return typeof value === "string" ? value : JSON.stringify(value);
    }

    function makeFakeLogger() {
      const records: LogRecord[] = [];
      const make =
        (level: LogRecord["level"]) =>
        (message: unknown): void => {
          records.push({ level, message: toMessage(message) });
        };
      return {
        records,
        logger: {
          log: make("log"),
          error: make("error"),
          warn: make("warn"),
          debug: make("debug"),
          verbose: make("verbose"),
        },
      };
    }

    it("emits truncated summary at .debug and full payload at .verbose", () => {
      const { logger, records } = makeFakeLogger();
      const reveals = [makeSubmission(OVERSIZED_HEX)];
      const votingRoundId = 42;

      // Mirror the exact dispatch used in DataManager.getDataForCalculations.
      logger.debug(`Reveals for voting round ${votingRoundId}: ${formatSubmissionsForLog(reveals)}`);
      logger.verbose?.(`Reveals payload for voting round ${votingRoundId}: ${JSON.stringify(reveals)}`);

      const debugRecord = records.find((r) => r.level === "debug");
      const verboseRecord = records.find((r) => r.level === "verbose");

      expect(debugRecord, "debug log was emitted").to.not.equal(undefined);
      expect(verboseRecord, "verbose log was emitted").to.not.equal(undefined);
      if (debugRecord === undefined || verboseRecord === undefined) {
        return; // Narrowing for the assertions below; the expect() calls above already failed.
      }

      // .debug message must NOT contain the oversized payload.
      expect(debugRecord.message).to.not.include(OVERSIZED_HEX);
      expect(debugRecord.message).to.include("count=1");

      // .verbose message DOES contain the payload.
      expect(verboseRecord.message).to.include(OVERSIZED_HEX);
    });

    it("is safe when verbose is not implemented (optional method)", () => {
      // ILogger.verbose is optional; emulate a logger that does not implement it.
      const records: LogRecord[] = [];
      const logger: {
        log: (m: unknown) => void;
        error: (m: unknown) => void;
        warn: (m: unknown) => void;
        debug: (m: unknown) => void;
        verbose?: (m: unknown) => void;
      } = {
        log: (m) => records.push({ level: "log", message: toMessage(m) }),
        error: (m) => records.push({ level: "error", message: toMessage(m) }),
        warn: (m) => records.push({ level: "warn", message: toMessage(m) }),
        debug: (m) => records.push({ level: "debug", message: toMessage(m) }),
      };

      const reveals = [makeSubmission(OVERSIZED_HEX)];

      // The DataManager pattern uses optional chaining: this must not throw.
      logger.debug(`Reveals: ${formatSubmissionsForLog(reveals)}`);
      logger.verbose?.(`Reveals payload: ${JSON.stringify(reveals)}`);

      expect(records.filter((r) => r.level === "verbose")).to.have.length(0);
      expect(records.filter((r) => r.level === "debug")).to.have.length(1);
      expect(records[0].message).to.not.include(OVERSIZED_HEX);
    });
  });
});
