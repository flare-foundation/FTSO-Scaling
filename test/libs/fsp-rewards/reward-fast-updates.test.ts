import { expect } from "chai";
import { FastUpdateFeedConfiguration } from "../../../libs/contracts/src/events/FUInflationRewardsOffered";
import { FTSO2_FAST_UPDATES_PROTOCOL_ID } from "../../../libs/fsp-rewards/src/constants";
import { calculateFastUpdatesClaims } from "../../../libs/fsp-rewards/src/reward-calculation/reward-fast-updates";
import { IFUPartialRewardOfferForRound } from "../../../libs/fsp-rewards/src/utils/PartialRewardOffer";
import { ClaimType } from "../../../libs/fsp-rewards/src/utils/RewardClaim";
import { VoterWeights } from "../../../libs/ftso-core/src/RewardEpoch";
import { emptyLogger } from "../../../libs/ftso-core/src/utils/ILogger";
import { MedianCalculationResult } from "../../../libs/ftso-core/src/voting-types";
import { generateAddress, toFeedId } from "../../utils/generators";
import { getTestFile } from "../../utils/getTestFile";

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

describe(`Reward fast updates (${getTestFile(__filename)})`, () => {
  it("splits active FIP.16 block-latency rewards by capped delegation and 5x stake", () => {
    withFip16Activation(() => {
      const feedId = toFeedId("FLR/USD");
      const signingAddress = generateAddress("signing");
      const delegationAddress = generateAddress("delegation");
      const identityAddress = generateAddress("identity");
      const nodeId = generateAddress("node");
      const offer: IFUPartialRewardOfferForRound = {
        votingRoundId: 100,
        feedId,
        amount: 600n,
        rewardBandValue: 0,
      };
      const medianResult: MedianCalculationResult = {
        votingRoundId: offer.votingRoundId,
        feed: { id: feedId, decimals: 2 },
        votersSubmitAddresses: [],
        feedValues: [],
        data: {
          finalMedian: { isEmpty: false, value: 100, decimals: 2 },
          quartile1: { isEmpty: false, value: 100, decimals: 2 },
          quartile3: { isEmpty: false, value: 100, decimals: 2 },
          participatingWeight: 1n,
        },
        weights: [],
        totalVotingWeight: 1n,
      };
      const feedConfiguration: FastUpdateFeedConfiguration = {
        feedId,
        rewardBandValue: 0,
        inflationShare: 0,
      };
      const voterWeights: VoterWeights = {
        identityAddress,
        submitAddress: generateAddress("submit"),
        signingAddress,
        delegationAddress,
        delegationWeight: 100n,
        cappedDelegationWeight: 100n,
        signingWeight: 600,
        feeBIPS: 0,
        nodeIds: [nodeId],
        nodeWeights: [100n],
      };

      const claims = calculateFastUpdatesClaims(
        offer,
        medianResult,
        { feedId, value: 100n, decimals: 2 },
        feedConfiguration,
        [signingAddress],
        new Map([[signingAddress, delegationAddress]]),
        new Map([[signingAddress, identityAddress]]),
        new Map([[signingAddress, 0]]),
        new Map([[signingAddress, voterWeights]]),
        1,
        emptyLogger
      );

      expect(claims.reduce((sum, claim) => sum + claim.amount, 0n)).to.eq(offer.amount);
      expect(claims.find((claim) => claim.claimType === ClaimType.WNAT)?.amount).to.eq(100n);
      expect(claims.find((claim) => claim.claimType === ClaimType.MIRROR)?.amount).to.eq(500n);
      expect(claims.every((claim) => claim.protocolTag === String(FTSO2_FAST_UPDATES_PROTOCOL_ID))).to.eq(true);
    });
  });
});
