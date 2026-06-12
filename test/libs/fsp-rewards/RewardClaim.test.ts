import { expect } from "chai";
import { getTestFile } from "../../utils/getTestFile";
import { IPartialRewardClaim, IRewardClaim, RewardClaim } from "../../../libs/fsp-rewards/src/utils/RewardClaim";
import { id } from "ethers";
import { generateAddress } from "../../utils/generators";

describe(`RewardClaim (${getTestFile(__filename)})`, () => {
  const partialRewardClaims: IPartialRewardClaim[] = [];

  for (let j = 0; j < 10; j++) {
    const partialRewardClaim: IPartialRewardClaim = {
      beneficiary: id(`beneficiary${j}`).slice(0, 42),
      amount: 10n + BigInt(j),
      claimType: 0,
    };

    partialRewardClaims.push(partialRewardClaim);
  }

  for (let j = 0; j < 10; j++) {
    const partialRewardClaim: IPartialRewardClaim = {
      beneficiary: id(`beneficiary${j}`).slice(0, 42),
      amount: 10n + BigInt(j),
      claimType: 1,
    };

    partialRewardClaims.push(partialRewardClaim);
  }

  for (let j = 0; j < 10; j++) {
    const partialRewardClaim: IPartialRewardClaim = {
      beneficiary: id(`beneficiary${j}`).slice(0, 42),
      amount: 1n,
      claimType: 0,
    };

    partialRewardClaims.push(partialRewardClaim);
  }

  it("merges partial claims by (beneficiary, claimType)", () => {
    const mergedClaims = RewardClaim.merge(partialRewardClaims);

    const mergedClaims2 = RewardClaim.merge([
      {
        beneficiary: "0xc371c31e2abde7707c95647a10f09c4e1141f6fd",
        amount: 1n,
        claimType: 0,
      },
      {
        beneficiary: "0xc371c31e2abde7707c95647a10f09c4e1141f6fd",
        amount: 2n,
        claimType: 0,
      },
    ]);
    expect(mergedClaims2[0].amount).to.eq(3n);

    expect(mergedClaims.length).to.eq(20);
  });

  it("converts partial claims to full RewardClaims with the given epoch id", () => {
    const fullRewardClaim = RewardClaim.convertToRewardClaims(19003, partialRewardClaims);

    expect(fullRewardClaim[6].rewardEpochId).to.eq(19003);
  });

  it("computes a 32-byte hash for a valid claim", () => {
    const rewardClaim: IRewardClaim = {
      beneficiary: "0xc371c31e2abde7707c95647a10f09c4e1141f6fd",
      amount: 1n,
      claimType: 0,
      rewardEpochId: 109902,
    };

    const hash = RewardClaim.hashRewardClaim(rewardClaim);

    expect(hash.length).to.eq(66);
  });

  it("throws when hashing a claim with a malformed beneficiary address", () => {
    const rewardClaim: IRewardClaim = {
      beneficiary: "0xc371c31e2abde7707c95647a10f09c4e1141f6fd999",
      amount: 1n,
      claimType: 0,
      rewardEpochId: 109902,
    };

    expect(() => RewardClaim.hashRewardClaim(rewardClaim)).to.throw();
  });

  describe("mergeWithBurnClaims", () => {
    it("drops zero-amount claims", () => {
      const rewardClaim: IRewardClaim = {
        beneficiary: "0xc371c31e2abde7707c95647a10f09c4e1141f6fd999",
        amount: 0n,
        claimType: 0,
        rewardEpochId: 109902,
      };

      const merged = RewardClaim.mergeWithBurnClaims([rewardClaim], generateAddress("burn"));

      expect(merged.length).to.eq(0);
    });

    it("drops standalone negative claims", () => {
      const rewardClaim: IRewardClaim = {
        beneficiary: "0xc371c31e2abde7707c95647a10f09c4e1141f6fd999",
        amount: -1n,
        claimType: 0,
        rewardEpochId: 109902,
      };

      const merged = RewardClaim.mergeWithBurnClaims([rewardClaim], generateAddress("burn"));

      expect(merged.length).to.eq(0);
    });

    it("cancels matched positive+negative claims and redirects to burn", () => {
      const rewardClaim1: IRewardClaim = {
        beneficiary: "0xc371c31e2abde7707c95647a10f09c4e1141f6fd",
        amount: -1n,
        claimType: 0,
        rewardEpochId: 109902,
      };

      const rewardClaim2: IRewardClaim = {
        beneficiary: "0xc371c31e2abde7707c95647a10f09c4e1141f6fd",
        amount: 1n,
        claimType: 0,
        rewardEpochId: 109902,
      };

      const merged = RewardClaim.mergeWithBurnClaims([rewardClaim1, rewardClaim2], generateAddress("burn"));

      expect(merged.length).to.eq(1);
      expect(merged[0].beneficiary).to.eq(generateAddress("burn"));
    });

    it("redirects the unmatched negative remainder to burn", () => {
      const rewardClaim1: IRewardClaim = {
        beneficiary: "0xc371c31e2abde7707c95647a10f09c4e1141f6fd",
        amount: -2n,
        claimType: 0,
        rewardEpochId: 109903,
      };

      const rewardClaim2: IRewardClaim = {
        beneficiary: "0xc371c31e2abde7707c95647a10f09c4e1141f6fd",
        amount: 1n,
        claimType: 0,
        rewardEpochId: 109903,
      };

      const merged = RewardClaim.mergeWithBurnClaims([rewardClaim1, rewardClaim2], generateAddress("burn"));

      expect(merged.length).to.eq(1);
      expect(merged[0].beneficiary).to.eq(generateAddress("burn"));
      expect(merged[0].amount).to.eq(1n);
    });

    it("keeps the positive remainder and burns the cancelled portion", () => {
      const rewardClaim1: IRewardClaim = {
        beneficiary: "0xc371c31e2abde7707c95647a10f09c4e1141f6fd",
        amount: 3n,
        claimType: 0,
        rewardEpochId: 109903,
      };

      const rewardClaim2: IRewardClaim = {
        beneficiary: "0xc371c31e2abde7707c95647a10f09c4e1141f6fd",
        amount: -1n,
        claimType: 0,
        rewardEpochId: 109903,
      };

      const merged = RewardClaim.mergeWithBurnClaims([rewardClaim1, rewardClaim2], generateAddress("burn"));

      expect(merged.length).to.eq(2);
      expect(merged[0].beneficiary).to.eq(generateAddress("burn"));
      expect(merged[0].amount).to.eq(1n);
      expect(merged[1].beneficiary).to.eq("0xc371c31e2abde7707c95647a10f09c4e1141f6fd");
      expect(merged[1].amount).to.eq(2n);
    });

    it("leaves a lone positive claim untouched", () => {
      const rewardClaim: IRewardClaim = {
        beneficiary: "0xc371c31e2abde7707c95647a10f09c4e1141f6fd",
        amount: 1n,
        claimType: 0,
        rewardEpochId: 109903,
      };

      const merged = RewardClaim.mergeWithBurnClaims([rewardClaim], generateAddress("burn"));

      expect(merged.length).to.eq(1);
      expect(merged[0].beneficiary).to.eq("0xc371c31e2abde7707c95647a10f09c4e1141f6fd");
      expect(merged[0].amount).to.eq(1n);
    });
  });
});
