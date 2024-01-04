import BN from "bn.js";
import { getTestFile } from "../../test-utils/constants";
import { calculateMedian } from "../../libs/ftso-core/src/price-calculation";
import { toBN } from "../../libs/ftso-core/src/utils/voting-utils";
import { MedianCalculationSummary } from "../../libs/ftso-core/src/voting-types";
import { before } from "node:test";
import { expect } from "chai";

describe(`median-calculation-utils; ${getTestFile(__filename)}`, () => {
  let numVoters: number;
  let totalWeightSum: number;
  let voters: string[];
  let prices: BN[];
  let weights: BN[];
  let medianCalculationSummary: MedianCalculationSummary;

  describe("when total weight is odd", () => {
    before(() => {
      voters = [];
      prices = [];
      weights = [];
      totalWeightSum = 891;
      numVoters = 99;
      for (let index = 1; index <= numVoters; index++) {
        const voter = "voter" + index;
        const price = toBN(index);
        const weight = toBN(totalWeightSum / numVoters);

        voters.push(voter);
        prices.push(price);
        weights.push(weight);
      }
    });

    it("should calculate the correct median", () => {
      medianCalculationSummary = calculateMedian(voters, prices, weights);

      // the first with the median sum over the half of total weight should be 50 (among 99)
      expect(medianCalculationSummary.finalMedianPrice).to.equal(50);
      // the first with the quartile sum over the quarter of total weight should be 25
      expect(medianCalculationSummary.quartile1Price).to.equal(25);
      expect(medianCalculationSummary.quartile3Price).to.equal(75);
    });
  });

  describe("when the total weight W is even and the median sum equal to W/2", () => {
    before(() => {
      voters = [];
      prices = [];
      weights = [];
      totalWeightSum = 1000;
      numVoters = 100;
      for (let index = 1; index <= numVoters; index++) {
        const voter = "voter" + index;
        const price = toBN(index);
        const weight = toBN(totalWeightSum / numVoters);

        voters.push(voter);
        prices.push(price);
        weights.push(weight);
      }
    });

    it("should calculate the correct median", () => {
      medianCalculationSummary = calculateMedian(voters, prices, weights);

      // the first with the median sum equal the half of the total weight should be 50 (among 100)
      expect(medianCalculationSummary.finalMedianPrice).to.equal(50);
      // the first with the quartile sum over the quarter of the total weight should be 26
      expect(medianCalculationSummary.quartile1Price).to.equal(26);
      expect(medianCalculationSummary.quartile3Price).to.equal(75);
    });
  });

  describe("when the total weight W is even and the median sum grater than W/2", () => {
    before(() => {
      voters = [];
      prices = [];
      weights = [];
      totalWeightSum = 990;
      numVoters = 99;
      for (let index = 1; index <= numVoters; index++) {
        const voter = "voter" + index;
        const price = toBN(index);
        const weight = toBN(totalWeightSum / numVoters);

        voters.push(voter);
        prices.push(price);
        weights.push(weight);
      }
    });
    it("should calculate the correct median", () => {
      medianCalculationSummary = calculateMedian(voters, prices, weights);

      // the first with the median sum equal the half of the total weight should be 50 (among 99)
      expect(medianCalculationSummary.finalMedianPrice).to.equal(50);
      // the first with the quartile sum over the quarter of the total weight should be 25
      expect(medianCalculationSummary.quartile1Price).to.equal(25);
      expect(medianCalculationSummary.quartile3Price).to.equal(75);
    });
  });

  describe("when weights are non-uniform", () => {
    before(() => {
      voters = [];
      prices = [];
      weights = [];
      numVoters = 100;
      totalWeightSum = (100 * 101) / 2; // sum_{i=1}^{100} i
      for (let index = 1; index <= numVoters; index++) {
        const voter = "voter" + index;
        const price = toBN(numVoters - index + 1);
        const weight = toBN(numVoters - index + 1);

        voters.push(voter);
        prices.push(price);
        weights.push(weight);
      }
    });

    it("should calculate the correct median", () => {
      medianCalculationSummary = calculateMedian(voters, prices, weights);

      const expectedMedianPrice = 71; // since sum_{i=1}^71 i = 2556 > 2525 = totalWeightSum / 2
      expect(medianCalculationSummary.finalMedianPrice).to.equal(expectedMedianPrice);
      const expectedquartile1Price = 50; // since sum_{i=1}^50 i = 1275 > 1262.5 = totalWeightSum / 4
      expect(medianCalculationSummary.quartile1Price).to.equal(expectedquartile1Price);
      const expectedquartile3Price = 87; // since sum_{i=87}^100 i = 1309 > 1262.5 = totalWeightSum / 4
      expect(medianCalculationSummary.quartile3Price).to.equal(expectedquartile3Price);
    });
  });
});
