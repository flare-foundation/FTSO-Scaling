import { sleepFor } from "../../src/time-utils";
import { retry } from "../../src/utils/retry";
import { getTestFile } from "../../test-utils/utils/constants";

const MAX_RETRIES = 3;
const RETRY_TIMEOUT = 0;
const RESULT = 42;

describe(`retry; ${getTestFile(__filename)}`, () => {
  it("should return the result of the function if it succeeds on the first try", async () => {
    const result = await retry(() => RESULT, MAX_RETRIES, RETRY_TIMEOUT);
    expect(result).to.equal(RESULT);
  });

  it("should return the result of the async function if it succeeds on the first try", async () => {
    const result = await retry(
      async () => {
        await sleepFor(0);
        return RESULT;
      },
      MAX_RETRIES,
      RETRY_TIMEOUT
    );
    expect(result).to.equal(RESULT);
  });

  it("should retry the function until it succeeds", async () => {
    let attempts = 0;
    const f = () => {
      attempts++;
      if (attempts < MAX_RETRIES) throw new Error("Failed attempt");
      return RESULT;
    };
    const result = await retry(f, MAX_RETRIES, RETRY_TIMEOUT);
    expect(result).to.equal(RESULT);
    expect(attempts).to.equal(MAX_RETRIES);
  });

  it("should retry the async function until it succeeds", async () => {
    let attempts = 0;
    const f = async () => {
      await sleepFor(0);
      attempts++;
      if (attempts < MAX_RETRIES) throw new Error("Failed attempt");
      return RESULT;
    };
    const result = await retry(f, MAX_RETRIES, RETRY_TIMEOUT);
    expect(result).to.equal(RESULT);
    expect(attempts).to.equal(MAX_RETRIES);
  });

  it("should throw an error if the function fails on all retries", async () => {
    const f = () => {
      throw new Error("Always fails");
    };
    expect(retry(f, MAX_RETRIES, RETRY_TIMEOUT)).to.be.rejected;
  });

  it("should throw an error if the async function fails on all retries", async () => {
    const f = async () => {
      await sleepFor(0);
      throw new Error("Always fails");
    };
    expect(retry(f, MAX_RETRIES, RETRY_TIMEOUT)).to.be.rejected;
  });
});
