import { expect } from "chai";
import { getTestFile } from "../../utils/getTestFile";
import { IPartialRewardClaim, IRewardClaim, RewardClaim } from "../../../libs/fsp-rewards/src/utils/RewardClaim";
import Web3 from "web3";
import { generateAddress } from "../../utils/generators";

describe(`RewardClaim, ${getTestFile(__filename)}`, function () {
  const partialRewardClaims: IPartialRewardClaim[] = [];

  for (let j = 0; j < 10; j++) {
    const partialRewardClaim: IPartialRewardClaim = {
      beneficiary: Web3.utils.keccak256(`beneficiary${j}`).slice(0, 42),
      amount: 10n + BigInt(j),
      claimType: 0,
    };

    partialRewardClaims.push(partialRewardClaim);
  }

  for (let j = 0; j < 10; j++) {
    const partialRewardClaim: IPartialRewardClaim = {
      beneficiary: Web3.utils.keccak256(`beneficiary${j}`).slice(0, 42),
      amount: 10n + BigInt(j),
      claimType: 1,
    };

    partialRewardClaims.push(partialRewardClaim);
  }

  for (let j = 0; j < 10; j++) {
    const partialRewardClaim: IPartialRewardClaim = {
      beneficiary: Web3.utils.keccak256(`beneficiary${j}`).slice(0, 42),
      amount: 1n,
      claimType: 0,
    };

    partialRewardClaims.push(partialRewardClaim);
  }

  it("Should merge claims", function () {
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

  it("Should convert to full RewardClaim", function () {
    const fullRewardClaim = RewardClaim.convertToRewardClaims(19003, partialRewardClaims);

    expect(fullRewardClaim[6].rewardEpochId).to.eq(19003);
  });

  it("Should compute hash", function () {
    const rewardClaim: IRewardClaim = {
      beneficiary: "0xc371c31e2abde7707c95647a10f09c4e1141f6fd",
      amount: 1n,
      claimType: 0,
      rewardEpochId: 109902,
    };

    const hash = RewardClaim.hashRewardClaim(rewardClaim);

    expect(hash.length).to.eq(66);
  });

  it("Should not compute hash - wrong address length", function () {
    const rewardClaim: IRewardClaim = {
      beneficiary: "0xc371c31e2abde7707c95647a10f09c4e1141f6fd999",
      amount: 1n,
      claimType: 0,
      rewardEpochId: 109902,
    };

    expect(() => RewardClaim.hashRewardClaim(rewardClaim)).to.throw();
  });

  describe("Merge with claim", function () {
    it("Should remove zero claim", function () {
      const rewardClaim: IRewardClaim = {
        beneficiary: "0xc371c31e2abde7707c95647a10f09c4e1141f6fd999",
        amount: 0n,
        claimType: 0,
        rewardEpochId: 109902,
      };

      const merged = RewardClaim.mergeWithBurnClaims([rewardClaim], generateAddress("burn"));

      expect(merged.length).to.eq(0);
    });

    it("Should remove negative claim", function () {
      const rewardClaim: IRewardClaim = {
        beneficiary: "0xc371c31e2abde7707c95647a10f09c4e1141f6fd999",
        amount: -1n,
        claimType: 0,
        rewardEpochId: 109902,
      };

      const merged = RewardClaim.mergeWithBurnClaims([rewardClaim], generateAddress("burn"));

      expect(merged.length).to.eq(0);
    });

    it("Should cancel out and create burn claim", function () {
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

    it("Should not be negative", function () {
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

    it("Should leave positive claim", function () {
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

    it("Should leave the reminder", function () {
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
