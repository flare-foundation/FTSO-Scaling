import BN from "bn.js";
import { expect } from "chai";
import { MedianCalculationSummary } from "../../src/voting-interfaces";
import { toBN } from "../../src/voting-utils";
import { calculateMedian } from "../../src/median-calculation-utils";


describe("median-calculation-utils", () => {
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
                let voter = 'voter' + index;
                let price = toBN(index);
                let weight = toBN(totalWeightSum / numVoters);

                voters.push(voter);
                prices.push(price);
                weights.push(weight);
            }
        })

        it("should calculate the correct median", () => {
            medianCalculationSummary = calculateMedian(voters, prices, weights);

            // the first with the median sum over the half of total weight should be 50 (among 99)
            expect(medianCalculationSummary.finalMedianPrice).to.equal(50);
            // the first with the quartile sum over the quarter of total weight should be 25
            expect(medianCalculationSummary.quartile1Price).to.equal(25);
            expect(medianCalculationSummary.quartile3Price).to.equal(75);
        })
    })

    describe("when the total weight W is even and the median sum equal to W/2", () => {
        before(() => {
            voters = [];
            prices = [];
            weights = [];
            totalWeightSum = 1000;
            numVoters = 100;
            for (let index = 1; index <= numVoters; index++) {
                let voter = 'voter' + index;
                let price = toBN(index);
                let weight = toBN(totalWeightSum / numVoters);

                voters.push(voter);
                prices.push(price);
                weights.push(weight);
            }
        })

        it("should calculate the correct median", () => {
            medianCalculationSummary = calculateMedian(voters, prices, weights);

            // the first with the median sum equal the half of total weight should be 50 (among 100)
            expect(medianCalculationSummary.finalMedianPrice).to.equal(50);
            // the first with the quartile sum over the quarter of total weight should be 26
            expect(medianCalculationSummary.quartile1Price).to.equal(26);
            expect(medianCalculationSummary.quartile3Price).to.equal(75);
        })
    })

    describe("when the total weight W is even and the median sum grater than W/2", () => {
        before(() => {
            voters = [];
            prices = [];
            weights = [];
            totalWeightSum = 990;
            numVoters = 99;
            for (let index = 1; index <= numVoters; index++) {
                let voter = 'voter' + index;
                let price = toBN(index);
                let weight = toBN(totalWeightSum / numVoters);

                voters.push(voter);
                prices.push(price);
                weights.push(weight);
            }
        })
        it("should calculate the correct median", () => {
            medianCalculationSummary = calculateMedian(voters, prices, weights);

            // the first with the median sum equal the half of total weight should be 50 (among 99)
            expect(medianCalculationSummary.finalMedianPrice).to.equal(50);
            // the first with the quartile sum over the quarter of total weight should be 25
            expect(medianCalculationSummary.quartile1Price).to.equal(25);
            expect(medianCalculationSummary.quartile3Price).to.equal(75);
        })
    })
});
