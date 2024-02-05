import { expect } from "chai";
import { getTestFile } from "../../utils/getTestFile";
import { IPartialRewardClaim, IRewardClaim, RewardClaim } from "../../../libs/ftso-core/src/utils/RewardClaim";
import Web3 from "web3";

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
});
