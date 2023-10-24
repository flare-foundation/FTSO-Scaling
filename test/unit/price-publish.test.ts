import { describe, it } from "mocha";
import { expectEvent } from "@openzeppelin/test-helpers";
import { calculateEpochResult, calculateResultsForFeed } from "../../src/protocol/price-calculation";
import { ZERO_ADDRESS, toBN, toBytes4 } from "../../src/protocol/utils/voting-utils";
import { Feed, MedianCalculationResult } from "../../src/protocol/voting-types";
import { prepareSymbols } from "../EndToEnd.utils";
import { Bytes32 } from "../../src/protocol/utils/sol-types";
import { loadAccounts } from "../../deployment/tasks/common";
import { PriceOracleInstance } from "../../typechain-truffle/contracts/voting/implementation/PriceOracle";
import { MockContractInstance, VotingInstance } from "../../typechain-truffle";

const PriceOracle = artifacts.require("PriceOracle");
const Mock = artifacts.require("MockContract");
const Voting = artifacts.require("Voting");

describe("price-publish", function () {
  const priceEpochId = 1;
  const FEED_COUNT = 3;

  const random: [Bytes32, number] = [Bytes32.random(), 1];

  let priceOracle: PriceOracleInstance;
  let mock: MockContractInstance;
  let voting: VotingInstance;

  let wallets = loadAccounts(web3);
  let accounts = wallets.map(wallet => wallet.address);
  let governance = accounts[0];

  const getMerkleRootMethod = () => voting.contract.methods.getMerkleRootForPriceEpoch(0).encodeABI();

  before(async () => {
    priceOracle = await PriceOracle.new(governance);
    mock = await Mock.new();
    voting = await Voting.new(ZERO_ADDRESS, ZERO_ADDRESS);
    priceOracle.setVoting(mock.address);
  });

  it("should publish price epoch rsults", async () => {
    const symbols = prepareSymbols(FEED_COUNT);
    const medianResults = getMedianResults(symbols);
    const epochResult = calculateEpochResult(medianResults, random, priceEpochId);

    await mock.givenMethodReturn(getMerkleRootMethod(), epochResult.merkleRoot.value);

    const publishResult = await priceOracle.publishPrices(
      priceEpochId,
      epochResult.encodedBulkPrices,
      epochResult.encodedBulkSymbols,
      epochResult.bulkPriceProof.map(p => p.value),
      [...symbols.keys()]
    );

    symbols.forEach(feed => {
      expectEvent(publishResult, "PriceFeedPublished", {
        priceEpochId: toBN(priceEpochId),
        offerSymbol: toBytes4(feed.offerSymbol),
        quoteSymbol: toBytes4(feed.quoteSymbol),
      });
    });
  });
});

function getMedianResults(symbols: Feed[]): MedianCalculationResult[] {
  return symbols.map(feed => {
    let voters = [];
    let prices = [];
    let weights = [];
    let totalWeightSum = 1000;
    let numVoters = 100;
    for (let index = 1; index <= numVoters; index++) {
      let voter = "voter" + index;
      let price = toBN(index);
      let weight = toBN(totalWeightSum / numVoters);

      voters.push(voter);
      prices.push(price);
      weights.push(weight);
    }

    return calculateResultsForFeed(voters, prices, weights, feed);
  });
}
