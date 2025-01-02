import { expect } from "chai";
import { RewardOffers } from "../../../libs/contracts/src/events";
import {
  FeedWithTypeAndValue,
  rewardEpochFeedSequence,
  sortFeedWithValuesToCanonicalOrder,
} from "../../../libs/ftso-core/src/ftso-calculation/feed-ordering";
import { calculateMedian } from "../../../libs/ftso-core/src/ftso-calculation/ftso-median";
import { ValueWithDecimals } from "../../../libs/ftso-core/src/data/FeedValueEncoder";
import { Address } from "../../../libs/ftso-core/src/voting-types";
import { getTestFile } from "../../utils/getTestFile";

describe(`FTSO calculation logic, (${getTestFile(__filename)})`, () => {
  describe("calculateMedian", () => {
    let numVoters: number;
    let totalWeightSum: number;

    let voters: Address[];
    let feedValues: ValueWithDecimals[];
    let weights: bigint[];
    let decimals: number;

    describe("when total weight is odd", () => {
      before(() => {
        voters = [];
        feedValues = [];
        weights = [];
        decimals = 6;

        totalWeightSum = 891;
        numVoters = 99;
        for (let index = 1; index <= numVoters; index++) {
          const voter = "voter" + index;
          const value = index;
          const weight = BigInt(totalWeightSum / numVoters);

          voters.push(voter);
          feedValues.push({
            isEmpty: false,
            value: value,
            decimals: decimals,
          });
          weights.push(weight);
        }
      });

      it("should calculate the correct median", () => {
        const medianCalculationSummary = calculateMedian(voters, feedValues, weights, decimals);

        // the first with the median sum over the half of total weight should be 50 (among 99)
        expect(medianCalculationSummary.finalMedian.value).to.equal(50);
        expect(medianCalculationSummary.finalMedian.decimals).to.equal(decimals);
        // the first with the quartile sum over the quarter of total weight should be 25
        expect(medianCalculationSummary.quartile1.value).to.equal(25);
        expect(medianCalculationSummary.quartile3.value).to.equal(75);
        expect(medianCalculationSummary.participatingWeight).to.equal(BigInt(totalWeightSum));
      });
    });

    describe("when the total weight W is even and the median sum equal to W/2", () => {
      before(() => {
        voters = [];
        feedValues = [];
        weights = [];
        decimals = 6;

        totalWeightSum = 1000;
        numVoters = 100;
        for (let index = 1; index <= numVoters; index++) {
          const voter = "voter" + index;
          const value = index;
          const weight = BigInt(totalWeightSum / numVoters);

          voters.push(voter);
          feedValues.push({
            isEmpty: false,
            value: value,
            decimals: decimals,
          });
          weights.push(weight);
        }
      });

      it("should calculate the correct median", () => {
        const medianCalculationSummary = calculateMedian(voters, feedValues, weights, decimals);

        // the first with the median sum equal the half of the total weight should be 50 (among 100)
        expect(medianCalculationSummary.finalMedian.value).to.equal(50);
        expect(medianCalculationSummary.finalMedian.decimals).to.equal(decimals);
        // the first with the quartile sum over the quarter of the total weight should be 26
        expect(medianCalculationSummary.quartile1.value).to.equal(26);
        expect(medianCalculationSummary.quartile3.value).to.equal(75);
        expect(medianCalculationSummary.participatingWeight).to.equal(BigInt(totalWeightSum));
      });
    });

    describe("when the total weight W is even and the median sum grater than W/2", () => {
      before(() => {
        voters = [];
        feedValues = [];
        weights = [];
        decimals = 6;

        totalWeightSum = 990;
        numVoters = 99;
        for (let index = 1; index <= numVoters; index++) {
          const voter = "voter" + index;
          const value = index;
          const weight = BigInt(totalWeightSum / numVoters);

          voters.push(voter);
          feedValues.push({
            isEmpty: false,
            value: value,
            decimals: decimals,
          });
          weights.push(weight);
        }
      });

      it("should calculate the correct median", () => {
        const medianCalculationSummary = calculateMedian(voters, feedValues, weights, decimals);

        // the first with the median sum equal the half of the total weight should be 50 (among 99)
        expect(medianCalculationSummary.finalMedian.value).to.equal(50);
        // the first with the quartile sum over the quarter of the total weight should be 25
        expect(medianCalculationSummary.quartile1.value).to.equal(25);
        expect(medianCalculationSummary.quartile3.value).to.equal(75);
        expect(medianCalculationSummary.participatingWeight).to.equal(BigInt(totalWeightSum));
      });
    });

    describe("when weights are non-uniform", () => {
      before(() => {
        voters = [];
        feedValues = [];
        weights = [];
        decimals = 6;

        numVoters = 100;
        totalWeightSum = 50 * 101; // sum_{i=1}^{100} i = (i + (i+1))/2
        for (let index = 1; index <= numVoters; index++) {
          const voter = "voter" + index;
          const value = numVoters - index + 1;
          const weight = BigInt(numVoters - index + 1);

          voters.push(voter);
          feedValues.push({
            isEmpty: false,
            value: value,
            decimals: decimals,
          });
          weights.push(weight);
        }
      });

      it("should calculate the correct median", () => {
        const medianCalculationSummary = calculateMedian(voters, feedValues, weights, decimals);

        const expectedMedian = 71; // since sum_{i=1}^71 i = 2556 > 2525 = totalWeightSum / 2
        expect(medianCalculationSummary.finalMedian.value).to.equal(expectedMedian);
        const expectedQuartile1 = 50; // since sum_{i=1}^50 i = 1275 > 1262.5 = totalWeightSum / 4
        expect(medianCalculationSummary.quartile1.value).to.equal(expectedQuartile1);
        const expectedQuartile3 = 87; // since sum_{i=87}^100 i = 1309 > 1262.5 = totalWeightSum / 4
        expect(medianCalculationSummary.quartile3.value).to.equal(expectedQuartile3);
        expect(medianCalculationSummary.participatingWeight).to.equal(BigInt(totalWeightSum));
      });
    });

    describe("median is the average of 2 values", () => {
      before(() => {
        voters = ["voter1", "voter2"];
        feedValues = [
          {
            isEmpty: false,
            value: 2,
            decimals: decimals,
          },
          {
            isEmpty: false,
            value: 4,
            decimals: decimals,
          },
        ];
        weights = [1n, 1n];
        decimals = 6;

        totalWeightSum = 2;
      });

      it("should calculate the correct median", () => {
        const medianCalculationSummary = calculateMedian(voters, feedValues, weights, decimals);

        expect(medianCalculationSummary.finalMedian.value).to.equal(3);
        expect(medianCalculationSummary.quartile1.value).to.equal(2);
        expect(medianCalculationSummary.quartile3.value).to.equal(4);
        expect(medianCalculationSummary.participatingWeight).to.equal(2n);
      });
    });

    describe("median is the average of 2 values float rounded down", () => {
      before(() => {
        voters = ["voter1", "voter2"];
        feedValues = [
          {
            isEmpty: false,
            value: 3,
            decimals: decimals,
          },
          {
            isEmpty: false,
            value: 4,
            decimals: decimals,
          },
        ];
        weights = [1n, 1n];
        decimals = 6;

        totalWeightSum = 2;
      });

      it("should calculate the correct median", () => {
        const medianCalculationSummary = calculateMedian(voters, feedValues, weights, decimals);

        expect(medianCalculationSummary.finalMedian.value).to.equal(3);
        expect(medianCalculationSummary.quartile1.value).to.equal(3);
        expect(medianCalculationSummary.quartile3.value).to.equal(4);
        expect(medianCalculationSummary.participatingWeight).to.equal(2n);
      });
    });

    describe("when half of voters don't provide values, odd only", () => {
      before(() => {
        voters = [];
        feedValues = [];
        weights = [];
        decimals = 6;

        numVoters = 100;

        for (let index = 0; index < numVoters; index++) {
          if (index % 2 == 0) continue;
          const voter = "voter" + index;
          const weight = 10n;

          voters.push(voter);
          feedValues.push({
            isEmpty: false,
            value: index,
            decimals: decimals,
          });
          weights.push(weight);
        }
      });

      it("should calculate the correct median", () => {
        const medianCalculationSummary = calculateMedian(voters, feedValues, weights, decimals);

        expect(medianCalculationSummary.finalMedian.value).to.equal(50); // since (49 + 51) / 2 = 50
        expect(medianCalculationSummary.finalMedian.decimals).to.equal(decimals);
        expect(medianCalculationSummary.quartile1.value).to.equal(25);
        expect(medianCalculationSummary.quartile3.value).to.equal(75);
        expect(medianCalculationSummary.participatingWeight).to.equal(50n * 10n);
      });
    });

    describe("when half of voters don't provide values, even only", () => {
      before(() => {
        voters = [];
        feedValues = [];
        weights = [];
        decimals = 6;

        numVoters = 100;

        for (let index = 0; index < numVoters; index++) {
          if (index % 2 == 1) continue;
          const voter = "voter" + index;
          const weight = 10n;

          voters.push(voter);
          feedValues.push({
            isEmpty: false,
            value: index,
            decimals: decimals,
          });
          weights.push(weight);
        }
      });

      it("should calculate the correct median", () => {
        const medianCalculationSummary = calculateMedian(voters, feedValues, weights, decimals);

        expect(medianCalculationSummary.finalMedian.value).to.equal(49); // since (49 + 51) / 2 = 50
        expect(medianCalculationSummary.finalMedian.decimals).to.equal(decimals);
        expect(medianCalculationSummary.quartile1.value).to.equal(24);
        expect(medianCalculationSummary.quartile3.value).to.equal(74);
        expect(medianCalculationSummary.participatingWeight).to.equal(50n * 10n);
      });
    });
  });

  // describe("repack", () => {
  //   it("should repack correctly", () => {
  //     const voters = ["voter1", "voter2"];
  //     const feedValues = [
  //       {
  //         isEmpty: false,
  //         value: 3,
  //         decimals: 4,
  //       },
  //       {
  //         isEmpty: false,
  //         value: 4,
  //         decimals: 4,
  //       }
  //     ];
  //     const weights = [1n,1n];

  //     const repacked = repack(voters, feedValues, weights);
  //   })
  // });

  describe("sortFeedWithValuesToCanonicalOrder", () => {
    it("should sort correctly", () => {
      const feedWithTypeAndValueArray: FeedWithTypeAndValue[] = [
        {
          id: "0x464C520055534454", // FLR USDT
          decimals: 6,
          isInflation: true,
          flrValue: 1000n,
        },
        {
          id: "0x4254430055534454", // BTC USDT
          decimals: 4,
          isInflation: true,
          flrValue: 1000n,
        },
        {
          id: "0x5852500055534454", // XRP USDT
          decimals: 8,
          isInflation: true,
          flrValue: 1000n,
        },
        {
          id: "0x4554480055534454", // ETH USDT
          decimals: 6,
          isInflation: true,
          flrValue: 1000n,
        },
        // Non inflation
        {
          id: "0x474F4C4455534400", // GOLDUSD
          decimals: 8,
          isInflation: false,
          flrValue: 10000n,
        },
        {
          id: "0x4141504C00000000", // AAPL
          decimals: 8,
          isInflation: false,
          flrValue: 100n,
        },
        {
          id: "0x54534C4100000000", // TSLA
          decimals: 8,
          isInflation: false,
          flrValue: 100n,
        },
        {
          id: "0x5041483300000000", // PAH3
          decimals: 8,
          isInflation: false,
          flrValue: 1000n,
        },
      ];

      const sorted = sortFeedWithValuesToCanonicalOrder(feedWithTypeAndValueArray);

      const expectedOrder = [
        "0x4254430055534454", // BTC USDT
        "0x4554480055534454", // ETH USDT
        "0x464C520055534454", // FLR USDT
        "0x5852500055534454", // XRP USDT
        "0x474F4C4455534400", // GOLDUSD
        "0x5041483300000000", // PAH3
        "0x4141504C00000000", // AAPL
        "0x54534C4100000000", // TSLA
      ];

      expect(sorted.length).to.equal(8);
      for (let i = 0; i < sorted.length; i++) {
        expect(sorted[i].id).to.equal(expectedOrder[i]);
      }
    });
  });

  describe("rewardEpochFeedSequence", () => {
    it("should create the correct feed sequence: happy path", () => {
      const rewardOffers: RewardOffers = {
        inflationOffers: [
          {
            rewardEpochId: 1,
            feedIds: ["0x4254430055534454", "0x4554480055534454", "0x464c520055534454", "0x5852500055534454"],
            decimals: [6, 6, 6, 6],
            amount: 1000n,
            minRewardedTurnoutBIPS: 100,
            mode: 0,
            primaryBandRewardSharePPM: 500000,
            secondaryBandWidthPPMs: [100000, 200000, 300000, 400000],
          },
        ],
        rewardOffers: [
          {
            rewardEpochId: 1,
            feedId: "0x474F4C4455534400",
            decimals: 4,
            amount: 10000n,
            minRewardedTurnoutBIPS: 100,
            primaryBandRewardSharePPM: 500000,
            secondaryBandWidthPPM: 100000,
            claimBackAddress: "offer1",
          },
          {
            rewardEpochId: 1,
            feedId: "0x5041483300000000",
            decimals: 2,
            amount: 1000n,
            minRewardedTurnoutBIPS: 100,
            primaryBandRewardSharePPM: 500000,
            secondaryBandWidthPPM: 100000,
            claimBackAddress: "offer1",
          },
          {
            rewardEpochId: 1,
            feedId: "0x4141504C00000000",
            decimals: 2,
            amount: 100n,
            minRewardedTurnoutBIPS: 100,
            primaryBandRewardSharePPM: 500000,
            secondaryBandWidthPPM: 100000,
            claimBackAddress: "offer1",
          },
          {
            rewardEpochId: 1,
            feedId: "0x54534C4100000000",
            decimals: 2,
            amount: 100n,
            minRewardedTurnoutBIPS: 100,
            primaryBandRewardSharePPM: 500000,
            secondaryBandWidthPPM: 100000,
            claimBackAddress: "offer1",
          },
        ],
      };

      const feedSequence = rewardEpochFeedSequence(rewardOffers);

      const expectedOrder = [
        "0x4254430055534454", // BTC USDT
        "0x4554480055534454", // ETH USDT
        "0x464c520055534454", // FLR USDT
        "0x5852500055534454", // XRP USDT
        "0x474f4c4455534400", // GOLDUSD
        "0x5041483300000000", // PAH3
        "0x4141504c00000000", // AAPL
        "0x54534c4100000000", // TSLA
      ];

      expect(feedSequence.length).to.equal(8);

      expect(feedSequence.length).to.equal(8);
      for (let i = 0; i < feedSequence.length; i++) {
        expect(feedSequence[i].id).to.equal(expectedOrder[i]);
      }
    });

    it("should create the correct feed sequence: same feed in 2 inflation offers", () => {
      const rewardOffers: RewardOffers = {
        inflationOffers: [
          {
            rewardEpochId: 1,
            feedIds: ["0x4254430055534454", "0x4554480055534454", "0x464c520055534454"],
            decimals: [6, 6, 6, 6],
            amount: 1000n,
            minRewardedTurnoutBIPS: 100,
            mode: 0,
            primaryBandRewardSharePPM: 500000,
            secondaryBandWidthPPMs: [100000, 200000, 300000],
          },
          {
            rewardEpochId: 1,
            feedIds: ["0x464c520055534454", "0x5852500055534454"],
            decimals: [6, 6, 6, 6],
            amount: 1000n,
            minRewardedTurnoutBIPS: 100,
            mode: 0,
            primaryBandRewardSharePPM: 500000,
            secondaryBandWidthPPMs: [700000, 400000],
          },
        ],
        rewardOffers: [
          {
            rewardEpochId: 1,
            feedId: "0x474F4C4455534400",
            decimals: 4,
            amount: 10000n,
            minRewardedTurnoutBIPS: 100,
            primaryBandRewardSharePPM: 500000,
            secondaryBandWidthPPM: 100000,
            claimBackAddress: "offer1",
          },
          {
            rewardEpochId: 1,
            feedId: "0x5041483300000000",
            decimals: 2,
            amount: 1000n,
            minRewardedTurnoutBIPS: 100,
            primaryBandRewardSharePPM: 500000,
            secondaryBandWidthPPM: 100000,
            claimBackAddress: "offer1",
          },
          {
            rewardEpochId: 1,
            feedId: "0x4141504C00000000",
            decimals: 2,
            amount: 100n,
            minRewardedTurnoutBIPS: 100,
            primaryBandRewardSharePPM: 500000,
            secondaryBandWidthPPM: 100000,
            claimBackAddress: "offer1",
          },
          {
            rewardEpochId: 1,
            feedId: "0x54534C4100000000",
            decimals: 2,
            amount: 100n,
            minRewardedTurnoutBIPS: 100,
            primaryBandRewardSharePPM: 500000,
            secondaryBandWidthPPM: 100000,
            claimBackAddress: "offer1",
          },
        ],
      };

      const feedSequence = rewardEpochFeedSequence(rewardOffers);

      const expectedOrder = [
        "0x4254430055534454", // BTC USDT
        "0x4554480055534454", // ETH USDT
        "0x464c520055534454", // FLR USDT
        "0x5852500055534454", // XRP USDT
        "0x474f4c4455534400", // GOLDUSD
        "0x5041483300000000", // PAH3
        "0x4141504c00000000", // AAPL
        "0x54534c4100000000", // TSLA
      ];

      expect(feedSequence.length).to.equal(8);

      expect(feedSequence.length).to.equal(8);
      for (let i = 0; i < feedSequence.length; i++) {
        expect(feedSequence[i].id).to.equal(expectedOrder[i].toLowerCase());
      }
    });

    it("should create the correct feed sequence: multiple community offers for the same feed", () => {
      const rewardOffers: RewardOffers = {
        inflationOffers: [],
        rewardOffers: [
          {
            rewardEpochId: 1,
            feedId: "0x464c520055534454",
            decimals: 4,
            amount: 10000n,
            minRewardedTurnoutBIPS: 100,
            primaryBandRewardSharePPM: 500000,
            secondaryBandWidthPPM: 100000,
            claimBackAddress: "offer1",
          },
          {
            rewardEpochId: 1,
            feedId: "0x464c520055534454",
            decimals: 4,
            amount: 10000n,
            minRewardedTurnoutBIPS: 100,
            primaryBandRewardSharePPM: 500000,
            secondaryBandWidthPPM: 100000,
            claimBackAddress: "offer2",
          },
          {
            rewardEpochId: 1,
            feedId: "0x464c520055534454",
            decimals: 4,
            amount: 10000n,
            minRewardedTurnoutBIPS: 100,
            primaryBandRewardSharePPM: 500000,
            secondaryBandWidthPPM: 100000,
            claimBackAddress: "offer3",
          },
          {
            rewardEpochId: 1,
            feedId: "0x5347420055534454",
            decimals: 4,
            amount: 20000n,
            minRewardedTurnoutBIPS: 100,
            primaryBandRewardSharePPM: 500000,
            secondaryBandWidthPPM: 100000,
            claimBackAddress: "offer4",
          },
        ],
      };

      const feedSequence = rewardEpochFeedSequence(rewardOffers);
      expect(feedSequence.length).to.equal(2);
      expect(feedSequence[0].id).to.equal("0x464c520055534454");
      expect(feedSequence[1].id).to.equal("0x5347420055534454");
    });
  });
});
