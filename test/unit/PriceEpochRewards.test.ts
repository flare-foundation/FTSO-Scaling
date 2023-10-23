import { RewardLogic } from "../../src/protocol/RewardLogic";
import { toBN } from "../../src/protocol/utils/voting-utils";
import { getTestFile } from "../../test-utils/utils/constants";

describe(`PriceEpochRewards; ${getTestFile(__filename)}`, () => {
  const alice = "alice";
  const bob = "bob";
  const coinA = "coinA";
  const coinB = "coinB";

  it("should merge claims correctly", () => {
    const mergePriceEpochId = 123;
    const unmergedClaims = [
      {
        beneficiary: alice,
        currencyAddress: coinA,
        amount: toBN(100),
        priceEpochId: 1,
        isFixedClaim: true,
      },
      {
        beneficiary: alice,
        currencyAddress: coinA,
        amount: toBN(200),
        priceEpochId: 1,
        isFixedClaim: true,
      },
      {
        beneficiary: alice,
        currencyAddress: coinA,
        amount: toBN(300),
        priceEpochId: 1,
        isFixedClaim: false,
      },
      {
        beneficiary: alice,
        currencyAddress: coinA,
        amount: toBN(400),
        priceEpochId: 1,
        isFixedClaim: false,
      },
      {
        beneficiary: alice,
        currencyAddress: coinB,
        amount: toBN(500),
        priceEpochId: 1,
        isFixedClaim: false,
      },
      {
        beneficiary: bob,
        currencyAddress: coinB,
        amount: toBN(500),
        priceEpochId: 1,
        isFixedClaim: false,
      },
    ];

    const expectedMergedClaims = new Set([
      {
        beneficiary: alice,
        currencyAddress: coinA,
        amount: toBN(300),
        priceEpochId: mergePriceEpochId,
        isFixedClaim: true,
      },
      {
        beneficiary: alice,
        currencyAddress: coinA,
        amount: toBN(700),
        priceEpochId: mergePriceEpochId,
        isFixedClaim: false,
      },
      {
        beneficiary: alice,
        currencyAddress: coinB,
        amount: toBN(500),
        priceEpochId: mergePriceEpochId,
        isFixedClaim: false,
      },
      {
        beneficiary: bob,
        currencyAddress: coinB,
        amount: toBN(500),
        priceEpochId: mergePriceEpochId,
        isFixedClaim: false,
      },
    ]);

    const mergedClaims = RewardLogic.mergeClaims(mergePriceEpochId, unmergedClaims);
    expect(new Set(mergedClaims)).deep.be.equal(expectedMergedClaims);
  });

  describe("applyPenalty", () => {
    it("should apply penalty to fixed claim", () => {
      const claim = {
        beneficiary: alice,
        currencyAddress: coinA,
        amount: toBN(100),
        isFixedClaim: true,
        priceEpochId: 1,
      };
      const penalty = {
        beneficiary: alice,
        currencyAddress: coinA,
        amount: toBN(10),
        isFixedClaim: false,
        priceEpochId: 1,
      };
      const [resultClaim, resultPenalty] = RewardLogic.applyPenalty(claim, penalty);
      expect(resultClaim).to.deep.equal({
        ...claim,
        amount: toBN(90),
      });
      expect(resultPenalty).to.be.undefined;
    });

    it("should apply penalty to weighted claim", () => {
      const claim = {
        beneficiary: alice,
        currencyAddress: coinA,
        amount: toBN(100),
        isFixedClaim: false,
        priceEpochId: 1,
      };
      const penalty = {
        beneficiary: alice,
        currencyAddress: coinA,
        amount: toBN(10),
        isFixedClaim: false,
        priceEpochId: 1,
      };
      const [resultClaim, resultPenalty] = RewardLogic.applyPenalty(claim, penalty);
      expect(resultClaim).to.deep.equal({
        ...claim,
        amount: toBN(90),
      });
      expect(resultPenalty).to.be.undefined;
    });

    it("should not apply penalty if claim amount is less than penalty amount", () => {
      const claim = {
        beneficiary: alice,
        currencyAddress: coinA,
        amount: toBN(5),
        isFixedClaim: true,
        priceEpochId: 1,
      };
      const penalty = {
        beneficiary: alice,
        currencyAddress: coinA,
        amount: toBN(10),
        isFixedClaim: false,
        priceEpochId: 1,
      };
      const [resultClaim, resultPenalty] = RewardLogic.applyPenalty(claim, penalty);
      expect(resultClaim).to.be.undefined;
      expect(resultPenalty).to.deep.equal({
        ...penalty,
        amount: toBN(5),
      });
    });
  });
});
