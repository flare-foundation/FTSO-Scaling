import { expect } from "chai";
import { getTestFile } from "../../utils/getTestFile";
import { TimeoutError, retry, retryWithTimeout, sleepFor } from "../../../libs/ftso-core/src/utils/retry";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
chai.use(chaiAsPromised);

const MAX_RETRIES = 3;
const ZERO_BACKOFF = 0;
const RESULT = 42;

describe(`retry (${getTestFile(__filename)})`, () => {
  describe("retry", () => {
    it("returns the function's result when it succeeds on the first try", async () => {
      const result = await retry(
        async () => {
          await sleepFor(0);
          return RESULT;
        },
        MAX_RETRIES,
        ZERO_BACKOFF
      );
      expect(result).to.equal(RESULT);
    });

    it("retries until the function succeeds and returns the eventual value", async () => {
      let attempts = 0;
      const f = async () => {
        await sleepFor(0);
        attempts++;
        if (attempts < MAX_RETRIES) throw new Error("Failed attempt");
        return RESULT;
      };
      const result = await retry(f, MAX_RETRIES, ZERO_BACKOFF);
      expect(result).to.equal(RESULT);
      expect(attempts).to.equal(MAX_RETRIES);
    });

    it("rejects when the function fails on all retries", async () => {
      const f = async () => {
        await sleepFor(0);
        throw new Error("Always fails");
      };
      await expect(retry(f, MAX_RETRIES, ZERO_BACKOFF)).to.eventually.be.rejected;
    });
  });

  describe("retryWithTimeout", () => {
    it("returns the function's result when it succeeds on the first try", async () => {
      const result = await retryWithTimeout(
        async () => {
          await sleepFor(0);
          return RESULT;
        },
        1,
        MAX_RETRIES,
        ZERO_BACKOFF
      );
      expect(result).to.equal(RESULT);
    });

    it("retries until the function succeeds and returns the eventual value", async () => {
      let attempts = 0;
      const f = async () => {
        await sleepFor(0);
        attempts++;
        if (attempts < MAX_RETRIES) throw new Error("Failed attempt");
        return RESULT;
      };
      const result = await retryWithTimeout(f, 1, MAX_RETRIES, ZERO_BACKOFF);
      expect(result).to.equal(RESULT);
      expect(attempts).to.equal(MAX_RETRIES);
    });

    it("rejects when the function fails on all retries", async () => {
      const f = async () => {
        await sleepFor(0);
        throw new Error("Always fails");
      };
      await expect(retryWithTimeout(f, 1, MAX_RETRIES, ZERO_BACKOFF)).to.eventually.be.rejected;
    });

    it("rejects with a TimeoutError cause when each attempt exceeds the timeout", async () => {
      const f = async () => {
        await sleepFor(5);
        throw new Error("Always fails");
      };

      await expect(retryWithTimeout(f, 1, MAX_RETRIES, ZERO_BACKOFF))
        .to.be.rejectedWith(Error)
        .then((e) => {
          expect(e.cause).to.be.instanceOf(TimeoutError);
        });
    });
  });
});
