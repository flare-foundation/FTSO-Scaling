import { expect } from "chai";
import { calculateMedianRewardClaims } from "../../../libs/fsp-rewards/src/reward-calculation/reward-median";
import { PartialRewardOffer } from "../../../libs/fsp-rewards/src/utils/PartialRewardOffer";
import { ClaimType } from "../../../libs/fsp-rewards/src/utils/RewardClaim";
import { VoterWeights } from "../../../libs/ftso-core/src/RewardEpoch";
import { MedianCalculationResult } from "../../../libs/ftso-core/src/voting-types";
import {
  generateAddress,
  generateInflationRewardOffer,
  generateMedianCalculationResult,
  generateRewardsOffer,
  generateVotersWeights,
  toFeedId,
} from "../../utils/generators";
import { getTestFile } from "../../utils/getTestFile";
import { splitToVotingRoundsEqually } from "./generator-rewards.test";

function withFip16Activation(fn: () => void) {
  const originalNetwork = process.env.NETWORK;
  const originalActivation = process.env.FIP16_ACTIVATION_REWARD_EPOCH;
  process.env.NETWORK = "from-env";
  process.env.FIP16_ACTIVATION_REWARD_EPOCH = "1";
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

describe(`Reward median (${getTestFile(__filename)})`, () => {
  const medianCalculationResult = generateMedianCalculationResult(70, "USD EUR", 10);
  const medianCalculationResultLowTurnout = generateMedianCalculationResult(70, "USD EUR", 10, true);

  const voterWeights = generateVotersWeights(70);

  const inflationReward = generateInflationRewardOffer(["USD EUR"], 508);

  const partialRewardOfferInflation = PartialRewardOffer.fromInflationRewardOfferedEquallyDistributed(inflationReward);

  const splitPartialRewardOfferInflation = splitToVotingRoundsEqually(10, 100, partialRewardOfferInflation[0]);

  const offeredReward = generateRewardsOffer("USD EUR", 508, generateAddress("claimBack"), 10000000);

  const partialOfferedReward = PartialRewardOffer.fromRewardOffered(offeredReward);

  const splitPartialOfferedReward = splitToVotingRoundsEqually(10, 100, partialOfferedReward);

  const offeredRewardNoSecondary = generateRewardsOffer("USD EUR", 508, generateAddress("claimBack"), 10000000, 0);

  const partialOfferedRewardNoSecondary = PartialRewardOffer.fromRewardOffered(offeredRewardNoSecondary);

  const splitPartialOfferedRewardNoSecondary = splitToVotingRoundsEqually(10, 100, partialOfferedRewardNoSecondary);

  // Pre-FIP.16 reward epoch id, so the legacy delegation-only behaviour is exercised.
  const rewardEpochId = 0;

  it("distributes the full inflation offer across median claims", () => {
    const { rewardClaims } = calculateMedianRewardClaims(
      splitPartialRewardOfferInflation[0],
      medianCalculationResult,
      voterWeights,
      rewardEpochId
    );

    expect(rewardClaims.reduce((a, b) => a + b.amount, 0n)).to.be.eq(splitPartialRewardOfferInflation[0].amount);
  });

  it("burns the inflation offer in a single claim when turnout is too low", () => {
    const { rewardClaims } = calculateMedianRewardClaims(
      splitPartialRewardOfferInflation[0],
      medianCalculationResultLowTurnout,
      voterWeights,
      rewardEpochId
    );

    expect(rewardClaims.length).to.eq(1);
    expect(rewardClaims.reduce((a, b) => a + b.amount, 0n)).to.be.eq(splitPartialRewardOfferInflation[0].amount);
  });

  it("distributes the full community offer across median claims", () => {
    const { rewardClaims } = calculateMedianRewardClaims(
      splitPartialOfferedReward[0],
      medianCalculationResult,
      voterWeights,
      rewardEpochId
    );

    expect(rewardClaims.reduce((a, b) => a + b.amount, 0n)).to.be.eq(splitPartialOfferedReward[0].amount);
  });

  it("distributes a community offer with zero secondary band width", () => {
    const { rewardClaims } = calculateMedianRewardClaims(
      splitPartialOfferedRewardNoSecondary[0],
      medianCalculationResult,
      voterWeights,
      rewardEpochId
    );

    expect(rewardClaims.reduce((a, b) => a + b.amount, 0n)).to.be.eq(splitPartialOfferedRewardNoSecondary[0].amount);
  });

  it("splits active FIP.16 median rewards to stake-only voters and keeps them eligible for signing", () => {
    withFip16Activation(() => {
      const votingRoundId = 101;
      const feedId = toFeedId("USD TEST");
      const submitAddress = generateAddress("stake-only-submit");
      const signingAddress = generateAddress("stake-only-signing");
      const nodeId = generateAddress("stake-only-node");
      const offer = {
        votingRoundId,
        feedId,
        amount: 600n,
        minRewardedTurnoutBIPS: 0,
        primaryBandRewardSharePPM: 800000,
        secondaryBandWidthPPM: 100000,
        offerIndex: 0,
        claimBackAddress: generateAddress("claim-back"),
      };
      const calculationResult: MedianCalculationResult = {
        votingRoundId,
        feed: { id: feedId, decimals: 2 },
        votersSubmitAddresses: [submitAddress],
        feedValues: [{ isEmpty: false, value: 100, decimals: 2 }],
        data: {
          finalMedian: { isEmpty: false, value: 100, decimals: 2 },
          quartile1: { isEmpty: false, value: 90, decimals: 2 },
          quartile3: { isEmpty: false, value: 110, decimals: 2 },
          participatingWeight: 10n,
        },
        weights: [10n],
        totalVotingWeight: 10n,
      };
      const weights = new Map<string, VoterWeights>([
        [
          submitAddress,
          {
            identityAddress: generateAddress("stake-only-identity"),
            submitAddress,
            signingAddress,
            delegationAddress: generateAddress("stake-only-delegation"),
            delegationWeight: 0n,
            cappedDelegationWeight: 0n,
            signingWeight: 10,
            feeBIPS: 0,
            nodeIds: [nodeId],
            nodeWeights: [100n],
          },
        ],
      ]);

      const { rewardClaims, rewardedSigningAddresses } = calculateMedianRewardClaims(
        offer,
        calculationResult,
        weights,
        1
      );

      expect(rewardClaims.reduce((sum, claim) => sum + claim.amount, 0n)).to.eq(offer.amount);
      expect(rewardClaims.some((claim) => claim.claimType === ClaimType.WNAT && claim.amount > 0n)).to.eq(false);
      const mirrorClaim = rewardClaims.find((claim) => claim.claimType === ClaimType.MIRROR);
      expect(mirrorClaim?.beneficiary).to.eq(nodeId.toLowerCase());
      expect(mirrorClaim?.amount).to.eq(offer.amount);
      expect(rewardedSigningAddresses.has(signingAddress.toLowerCase())).to.eq(true);
    });
  });
});
