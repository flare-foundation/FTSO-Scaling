import { expect } from "chai";
import { RewardTypePrefix } from "../../../libs/fsp-rewards/src/reward-calculation/RewardTypePrefix";
import { generateSigningWeightBasedClaimsForVoter } from "../../../libs/fsp-rewards/src/reward-calculation/reward-signing-split";
import { IPartialRewardOfferForRound } from "../../../libs/fsp-rewards/src/utils/PartialRewardOffer";
import { ClaimType } from "../../../libs/fsp-rewards/src/utils/RewardClaim";
import { VoterWeights } from "../../../libs/ftso-core/src/RewardEpoch";
import { generateAddress } from "../../utils/generators";
import { getTestFile } from "../../utils/getTestFile";

function withFip16Activation(activationRewardEpoch: string, fn: () => void) {
  const originalNetwork = process.env.NETWORK;
  const originalActivation = process.env.FIP16_ACTIVATION_REWARD_EPOCH;
  process.env.NETWORK = "from-env";
  process.env.FIP16_ACTIVATION_REWARD_EPOCH = activationRewardEpoch;
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

describe(`Reward signing split (${getTestFile(__filename)})`, () => {
  const offer: IPartialRewardOfferForRound = {
    votingRoundId: 100,
    feedId: "0x01",
    amount: 600n,
    offerIndex: 0,
    claimBackAddress: generateAddress("claim-back"),
  };
  const voterWeights: VoterWeights = {
    identityAddress: generateAddress("identity"),
    submitAddress: generateAddress("submit"),
    signingAddress: generateAddress("signing"),
    delegationAddress: generateAddress("delegation"),
    delegationWeight: 100n,
    cappedDelegationWeight: 100n,
    signingWeight: 600,
    feeBIPS: 0,
    nodeIds: [generateAddress("node")],
    nodeWeights: [100n],
  };

  it("uses legacy 1:1 delegation-to-stake split before FIP.16 activation", () => {
    withFip16Activation("2", () => {
      const claims = generateSigningWeightBasedClaimsForVoter(
        offer.amount,
        offer,
        voterWeights,
        RewardTypePrefix.SIGNING,
        100,
        1
      );

      expect(claims.find((claim) => claim.claimType === ClaimType.WNAT)?.amount).to.eq(300n);
      expect(claims.find((claim) => claim.claimType === ClaimType.MIRROR)?.amount).to.eq(300n);
    });
  });

  it("uses capped delegation to 5x stake split once FIP.16 is active", () => {
    withFip16Activation("1", () => {
      const claims = generateSigningWeightBasedClaimsForVoter(
        offer.amount,
        offer,
        voterWeights,
        RewardTypePrefix.SIGNING,
        100,
        1
      );

      expect(claims.find((claim) => claim.claimType === ClaimType.WNAT)?.amount).to.eq(100n);
      expect(claims.find((claim) => claim.claimType === ClaimType.MIRROR)?.amount).to.eq(500n);
    });
  });
});
