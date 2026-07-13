import { expect } from "chai";
import { RewardEpoch } from "../../../libs/ftso-core/src/RewardEpoch";
import { DataForCalculations } from "../../../libs/ftso-core/src/data/DataForCalculations";
import { FeedValueEncoder } from "../../../libs/ftso-core/src/data/FeedValueEncoder";
import { IRevealData } from "../../../libs/ftso-core/src/data/RevealData";
import { MerkleTreeStructs } from "../../../libs/ftso-core/src/data/MerkleTreeStructs";
import { calculateMedianResults } from "../../../libs/ftso-core/src/ftso-calculation/ftso-median";
import { Address, Feed } from "../../../libs/ftso-core/src/voting-types";
import { getTestFile } from "../../utils/getTestFile";

function withFip16Activation(fn: () => void): void {
  const originalNetwork = process.env.NETWORK;
  const originalActivation = process.env.FIP16_ACTIVATION_REWARD_EPOCH;
  process.env.NETWORK = "from-env";
  process.env.FIP16_ACTIVATION_REWARD_EPOCH = "417";
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

describe(`FIP.16 zero-weight median handling (${getTestFile(__filename)})`, () => {
  const feed: Feed = { id: "0x4254430055534400", decimals: 0 };

  function dataForRewardEpoch(
    rewardEpochId: number,
    values: (number | undefined)[],
    weights: bigint[]
  ): DataForCalculations {
    const voters = values.map((_, index) => `voter${index + 1}`);
    const validEligibleReveals = new Map<Address, IRevealData>();
    const voterMedianVotingWeights = new Map<Address, bigint>();

    for (let i = 0; i < voters.length; i++) {
      validEligibleReveals.set(voters[i], {
        random: "0x" + "00".repeat(32),
        feeds: [feed],
        encodedValues: FeedValueEncoder.encode([values[i]], [feed]),
      });
      voterMedianVotingWeights.set(voters[i], weights[i]);
    }

    return {
      votingRoundId: 1,
      orderedVotersSubmitAddresses: voters,
      orderedVotersSubmitSignatureAddresses: [],
      validEligibleReveals,
      revealOffenders: new Set(),
      voterMedianVotingWeights,
      feedOrder: [feed],
      randomGenerationBenchingWindow: 0,
      benchingWindowRevealOffenders: new Set(),
      rewardEpoch: { rewardEpochId } as unknown as RewardEpoch,
    };
  }

  it("preserves the legacy result through epoch 416 and excludes zero-weight votes from epoch 417", () => {
    withFip16Activation(() => {
      const values = [10, 100, 200];
      const weights = [5n, 0n, 5n];

      const legacyResult = calculateMedianResults(dataForRewardEpoch(416, values, weights))[0];
      const fip16Result = calculateMedianResults(dataForRewardEpoch(417, values, weights))[0];

      expect(legacyResult.data.finalMedian.value).to.equal(55);
      expect(fip16Result.data.finalMedian.value).to.equal(105);
      expect(fip16Result.data.quartile1.value).to.equal(10);
      expect(fip16Result.data.quartile3.value).to.equal(200);
      expect(fip16Result.data.participatingWeight).to.equal(10n);
      expect(fip16Result.weights).to.deep.equal(weights);
      expect(fip16Result.votersSubmitAddresses).to.have.lengthOf(3);
    });
  });

  it("returns an empty median and zero turnout when all FIP.16 voting weight is zero", () => {
    withFip16Activation(() => {
      const result = calculateMedianResults(dataForRewardEpoch(417, [100], [0n]))[0];

      expect(result.data.finalMedian.isEmpty).to.equal(true);
      expect(result.data.quartile1.isEmpty).to.equal(true);
      expect(result.data.quartile3.isEmpty).to.equal(true);
      expect(result.data.participatingWeight).to.equal(0n);
      expect(() => MerkleTreeStructs.fromMedianCalculationResult(result)).to.not.throw();
      expect(MerkleTreeStructs.fromMedianCalculationResult(result).turnoutBIPS).to.equal(0);
    });
  });

  it("does not let a zero-weight value replace an empty positive-weight vote", () => {
    withFip16Activation(() => {
      const result = calculateMedianResults(dataForRewardEpoch(417, [100, undefined], [0n, 5n]))[0];
      const feedResult = MerkleTreeStructs.fromMedianCalculationResult(result);

      expect(result.data.finalMedian.isEmpty).to.equal(true);
      expect(result.data.participatingWeight).to.equal(0n);
      expect(result.totalVotingWeight).to.equal(5n);
      expect(feedResult.turnoutBIPS).to.equal(0);
    });
  });
});
