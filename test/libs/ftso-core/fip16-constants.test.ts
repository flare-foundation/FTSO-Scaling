import { expect } from "chai";
import {
  FIP16_ACTIVATION_REWARD_EPOCH,
  FIP16_NOT_ACTIVATED,
  FIP16_STAKE_WEIGHT_MULTIPLIER,
  isFip16Active,
  stakeWeightMultiplier,
} from "../../../libs/ftso-core/src/constants";
import { getTestFile } from "../../utils/getTestFile";

// These tests lock in the safety property that FIP.16 is OFF by default. Until the real per-network activation reward
// epochs are filled in, the calculator and data provider must reproduce the pre-FIP.16 behaviour byte-for-byte.
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
});
