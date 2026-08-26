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

describe(`Relay v2 constants (${getTestFile(__filename)})`, () => {
  // The addresses ship before the cutover is scheduled, so what keeps this inert is the activation epoch
  // alone. Until it is set, every reward epoch must grade with the legacy digest, byte for byte as before.
  it("is inert on every network until an activation epoch is set", () => {
    for (const network of ["flare", "songbird", "coston", "coston2"]) {
      withConstants({ NETWORK: network }, (constants) => {
        expect(constants.RELAY_V2_ACTIVATION_REWARD_EPOCH()).to.equal(constants.RELAY_V2_NOT_ACTIVATED);
        for (const rewardEpochId of [0, 417, 4000, 999999]) {
          expect(constants.sourceChainIdForRewardEpoch(rewardEpochId), `${network} epoch ${rewardEpochId}`).to.be
            .undefined;
        }
      });
    }
  });

  it("binds the chain id from the activation reward epoch on", () => {
    withConstants(
      { NETWORK: "local-test", CHAIN_ID: "31337", RELAY_V2_ACTIVATION_REWARD_EPOCH: "4000" },
      (constants) => {
        expect(constants.sourceChainIdForRewardEpoch(3999)).to.be.undefined;
        expect(constants.sourceChainIdForRewardEpoch(4000)).to.equal(31337);
        expect(constants.sourceChainIdForRewardEpoch(4001)).to.equal(31337);
      }
    );
  });

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

  it("rejects a malformed activation reward epoch", () => {
    expect(() =>
      withConstants({ NETWORK: "local-test", RELAY_V2_ACTIVATION_REWARD_EPOCH: "-1" }, (constants) =>
        constants.RELAY_V2_ACTIVATION_REWARD_EPOCH()
      )
    ).to.throw("RELAY_V2_ACTIVATION_REWARD_EPOCH");
  });
});
