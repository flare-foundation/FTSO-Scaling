import { expect } from "chai";
import { getTestFile } from "../../utils/getTestFile";

// Re-evaluates libs/ftso-core/src/constants under the given environment, so per-network values and the
// env-driven overrides can be observed without leaking state into other tests.
function withConstants(
  env: Record<string, string | undefined>,
  fn: (constants: typeof import("../../../libs/ftso-core/src/constants")) => void
): void {
  const modulePath = require.resolve("../../../libs/ftso-core/src/constants");
  const original: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    original[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  delete require.cache[modulePath];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    fn(require("../../../libs/ftso-core/src/constants"));
  } finally {
    delete require.cache[modulePath];
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// The chain id is the only new per-network value Relay v2 needs. A wrong one silently changes every digest,
// so it is pinned here rather than left to a deployment's environment.
describe(`Relay v2 chain id (${getTestFile(__filename)})`, () => {
  it("knows the chain id of each network", () => {
    for (const [network, chainId] of [
      ["flare", 14],
      ["songbird", 19],
      ["coston", 16],
      ["coston2", 114],
    ] as const) {
      withConstants({ NETWORK: network }, (constants) => expect(constants.CHAIN_ID()).to.equal(chainId));
    }
  });

  // from-env is not exercised here: loading constants under it requires unrelated deployment variables.
  it("takes the chain id from the environment where the network does not fix it", () => {
    withConstants({ NETWORK: "local-test", CHAIN_ID: "14" }, (constants) => expect(constants.CHAIN_ID()).to.equal(14));
    // local-test runs against Hardhat, so it needs no configuration to work out of the box
    withConstants({ NETWORK: "local-test", CHAIN_ID: undefined }, (constants) =>
      expect(constants.CHAIN_ID()).to.equal(31337)
    );
  });

  it("rejects a malformed chain id", () => {
    for (const chainId of ["-1", "0x1f", "later", "1.5"]) {
      expect(
        () => withConstants({ NETWORK: "local-test", CHAIN_ID: chainId }, (constants) => constants.CHAIN_ID()),
        `CHAIN_ID=${chainId}`
      ).to.throw("CHAIN_ID must be a non-negative integer");
    }
  });
});
