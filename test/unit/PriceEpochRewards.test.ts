import { PriceEpochRewards } from "../../src/PriceEpochRewards";
import { toBN } from "../../src/voting-utils";

describe("PriceEpochRewards", () => {
  it("should merge claims correctly", () => {
    const alice = "alice";
    const bob = "bob";
    const coinA = "coinA";
    const coinB = "coinB";
    const mergePriceEpochId = 123;

    const unmergedClaims = [
      {
        beneficiary: alice,
        currencyAddress: coinA,
        amount: toBN(100),
        epochId: 1,
        isFixedClaim: true,
      },
      {
        beneficiary: alice,
        currencyAddress: coinA,
        amount: toBN(200),
        epochId: 1,
        isFixedClaim: true,
      },
      {
        beneficiary: alice,
        currencyAddress: coinA,
        amount: toBN(300),
        epochId: 1,
        isFixedClaim: false,
      },
      {
        beneficiary: alice,
        currencyAddress: coinA,
        amount: toBN(400),
        epochId: 1,
        isFixedClaim: false,
      },
      {
        beneficiary: alice,
        currencyAddress: coinB,
        amount: toBN(500),
        epochId: 1,
        isFixedClaim: false,
      },
      {
        beneficiary: bob,
        currencyAddress: coinB,
        amount: toBN(500),
        epochId: 1,
        isFixedClaim: false,
      },
    ];

    const expectedMergedClaims = new Set([
      {
        beneficiary: alice,
        currencyAddress: coinA,
        amount: toBN(300),
        epochId: mergePriceEpochId,
        isFixedClaim: true,
      },
      {
        beneficiary: alice,
        currencyAddress: coinA,
        amount: toBN(700),
        epochId: mergePriceEpochId,
        isFixedClaim: false,
      },
      {
        beneficiary: alice,
        currencyAddress: coinB,
        amount: toBN(500),
        epochId: mergePriceEpochId,
        isFixedClaim: false,
      },
      {
        beneficiary: bob,
        currencyAddress: coinB,
        amount: toBN(500),
        epochId: mergePriceEpochId,
        isFixedClaim: false,
      },
    ]);

    const mergedClaims = PriceEpochRewards.mergeClaims(mergePriceEpochId, unmergedClaims);
    expect(new Set(mergedClaims)).deep.be.equal(expectedMergedClaims);
  });
});
