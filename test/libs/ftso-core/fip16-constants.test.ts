import { expect } from "chai";
import {
  FIP16_ACTIVATION_REWARD_EPOCH,
  FIP16_NOT_ACTIVATED,
  FIP16_STAKE_WEIGHT_MULTIPLIER,
  isFip16Active,
  stakeWeightMultiplier,
} from "../../../libs/ftso-core/src/constants";
import { getTestFile } from "../../utils/getTestFile";

function withFromEnvActivation(value: string | undefined, fn: () => void) {
  const originalNetwork = process.env.NETWORK;
  const originalActivation = process.env.FIP16_ACTIVATION_REWARD_EPOCH;
  process.env.NETWORK = "from-env";
  if (value === undefined) {
    delete process.env.FIP16_ACTIVATION_REWARD_EPOCH;
  } else {
    process.env.FIP16_ACTIVATION_REWARD_EPOCH = value;
  }
  try {
    fn();
  } finally {
    if (originalNetwork === undefined) {
      delete process.env.NETWORK;
    } else {
      process.env.NETWORK = originalNetwork;
    }
    if (originalActivation === undefined) {
      delete process.env.FIP16_ACTIVATION_REWARD_EPOCH;
    } else {
      process.env.FIP16_ACTIVATION_REWARD_EPOCH = originalActivation;
    }
  }
}

// Re-evaluates libs/ftso-core/src/constants under the given NETWORK to observe per-network constant values.
function freshConstants(network: string): typeof import("../../../libs/ftso-core/src/constants") {
  const modulePath = require.resolve("../../../libs/ftso-core/src/constants");
  const originalNetwork = process.env.NETWORK;
  process.env.NETWORK = network;
  delete require.cache[modulePath];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return
    return require("../../../libs/ftso-core/src/constants");
  } finally {
    delete require.cache[modulePath];
    if (originalNetwork === undefined) {
      delete process.env.NETWORK;
    } else {
      process.env.NETWORK = originalNetwork;
    }
  }
}

// These tests lock in the safety property that FIP.16 is OFF by default on networks where the activation reward epoch
// is not yet filled in — there the calculator and data provider must reproduce the pre-FIP.16 behaviour
// byte-for-byte. On Flare the activation epoch is pinned to 417.
// See docs/migrations/FIP-16-signing-weight-unification.md.
describe(`FIP.16 constants (${getTestFile(__filename)})`, () => {
  it("is not activated by default on the current network", () => {
    expect(FIP16_ACTIVATION_REWARD_EPOCH()).to.eq(FIP16_NOT_ACTIVATED);
  });

  it("reports inactive for any realistic reward epoch while not activated", () => {
    expect(isFip16Active(0)).to.eq(false);
    expect(isFip16Active(1_000_000)).to.eq(false);
  });

  it("uses a 1x stake multiplier (legacy 1:1 split) while not activated", () => {
    expect(stakeWeightMultiplier(0)).to.eq(1n);
    expect(stakeWeightMultiplier(1_000_000)).to.eq(1n);
  });

  it("activates exactly at the activation reward epoch, applying the 5x stake multiplier", () => {
    const activation = FIP16_ACTIVATION_REWARD_EPOCH();
    expect(isFip16Active(activation - 1)).to.eq(false);
    expect(isFip16Active(activation)).to.eq(true);
    expect(stakeWeightMultiplier(activation - 1)).to.eq(1n);
    expect(stakeWeightMultiplier(activation)).to.eq(FIP16_STAKE_WEIGHT_MULTIPLIER);
  });

  it("sets the initial stake weight multiplier to 5 per FIP.16", () => {
    expect(FIP16_STAKE_WEIGHT_MULTIPLIER).to.eq(5n);
  });

  it("activates on Flare at reward epoch 417", () => {
    const constants = freshConstants("flare");
    expect(constants.FIP16_ACTIVATION_REWARD_EPOCH()).to.eq(417);
    expect(constants.isFip16Active(416)).to.eq(false);
    expect(constants.isFip16Active(417)).to.eq(true);
  });

  for (const network of ["songbird", "coston", "coston2", "local-test"]) {
    it(`is not activated on ${network}`, () => {
      const constants = freshConstants(network);
      expect(constants.FIP16_ACTIVATION_REWARD_EPOCH()).to.eq(FIP16_NOT_ACTIVATED);
    });
  }

  it("uses a strict from-env activation reward epoch when provided", () => {
    withFromEnvActivation("42", () => {
      expect(FIP16_ACTIVATION_REWARD_EPOCH()).to.eq(42);
      expect(isFip16Active(41)).to.eq(false);
      expect(isFip16Active(42)).to.eq(true);
      expect(stakeWeightMultiplier(42)).to.eq(FIP16_STAKE_WEIGHT_MULTIPLIER);
    });
  });

  it("treats an absent or blank from-env activation reward epoch as not activated", () => {
    withFromEnvActivation(undefined, () => {
      expect(FIP16_ACTIVATION_REWARD_EPOCH()).to.eq(FIP16_NOT_ACTIVATED);
    });
    withFromEnvActivation("  ", () => {
      expect(FIP16_ACTIVATION_REWARD_EPOCH()).to.eq(FIP16_NOT_ACTIVATED);
    });
  });

  for (const invalidValue of ["42abc", "4.2", "-1", `${Number.MAX_SAFE_INTEGER + 1}`]) {
    it(`rejects malformed from-env activation reward epoch ${invalidValue}`, () => {
      withFromEnvActivation(invalidValue, () => {
        expect(() => FIP16_ACTIVATION_REWARD_EPOCH()).to.throw(
          "FIP16_ACTIVATION_REWARD_EPOCH must be a non-negative safe integer"
        );
      });
    });
  }
});
