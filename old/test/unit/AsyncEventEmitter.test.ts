import AsyncEventEmitter from "../../src/protocol/utils/AsyncEventEmitter";
import { sleepFor } from "../../src/utils/time";
import { getTestFile } from "../../test-utils/utils/constants";

describe(`AsyncEventEmitter; ${getTestFile(__filename)}`, () => {
  const EVENT = "test";
  let emitter: AsyncEventEmitter;

  beforeEach(() => {
    emitter = new (class extends AsyncEventEmitter {})();
  });

  afterEach(() => {
    emitter.removeAllListeners(EVENT);
  });

  it("should await listener completion on emit", async () => {
    let count = 0;
    const listener = async () => {
      await sleepFor(0);
      count++;
    };
    emitter.on(EVENT, listener);
    await emitter.emit(EVENT);
    await emitter.emit(EVENT);
    expect(count).to.be.equal(2);
  });

  it("should remove listener correctly", async () => {
    let count = 0;
    const listener = async () => {
      await sleepFor(0);
      count++;
    };
    emitter.on(EVENT, listener);
    await emitter.emit(EVENT);
    emitter.removeListener(EVENT, listener);
    await emitter.emit(EVENT);
    expect(count).to.be.equal(1);
  });

  it("should fire listener only once", async () => {
    let count = 0;
    const listener = async () => {
      await sleepFor(0);
      count++;
    };
    emitter.once(EVENT, listener);
    await emitter.emit(EVENT);
    await emitter.emit(EVENT);
    expect(count).to.be.equal(1);
  });

  it("should fire multiple listeners", async () => {
    let count = 0;
    const listener = async () => {
      await sleepFor(0);
      count++;
    };
    const listener2 = async () => {
      return listener();
    };
    emitter.on(EVENT, listener);
    emitter.on(EVENT, listener2);

    await emitter.emit(EVENT);
    expect(count).to.be.equal(2);
  });
});
