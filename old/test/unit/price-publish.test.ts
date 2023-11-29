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
  const PRICE_EPOCH_ID = 1;
  const FEED_COUNT = 3;
  const epochRandom: [Bytes32, number] = [Bytes32.random(), 1];

  const wallets = loadAccounts(web3);
  const accounts = wallets.map(wallet => wallet.address);
  const governance = accounts[0];

  let priceOracle: PriceOracleInstance;
  let mock: MockContractInstance;
  let voting: VotingInstance;

  const getMerkleRootMethod = () => voting.contract.methods.getMerkleRootForPriceEpoch(0).encodeABI();

  before(async () => {
    priceOracle = await PriceOracle.new(governance);
    mock = await Mock.new();
    voting = await Voting.new(ZERO_ADDRESS, ZERO_ADDRESS);
    priceOracle.setVoting(mock.address);
  });

  it("should publish correct prices for each feed", async () => {
    const symbols = prepareSymbols(FEED_COUNT);
    const medianResults = generateMedianResults(symbols);
    const epochResult = calculateEpochResult(medianResults, epochRandom, PRICE_EPOCH_ID);

    await mock.givenMethodReturn(getMerkleRootMethod(), epochResult.merkleRoot.value);

    const publishResult = await priceOracle.publishPrices(
      PRICE_EPOCH_ID,
      epochResult.encodedBulkPrices,
      epochResult.encodedBulkSymbols,
      epochResult.bulkPriceProof.map(p => p.value),
      [...symbols.keys()]
    );

    symbols.forEach((feed, index) => {
      expectEvent(publishResult, "PriceFeedPublished", {
        priceEpochId: toBN(PRICE_EPOCH_ID),
        // Value in solidity event is defined as bytes4, but the returned value is bytes32 for some reason - adding some padding.
        offerSymbol: web3.utils.padRight(toBytes4(feed.offerSymbol), 64),
        quoteSymbol: web3.utils.padRight(toBytes4(feed.quoteSymbol), 64),
        price: toBN(medianResults[index].data.finalMedianPrice),
      });
    });
  });
});

function generateMedianResults(symbols: Feed[]): MedianCalculationResult[] {
  const numVoters = 100;
  const totalWeightSum = 1000;
  const voters: string[] = [];
  const weights: BN[] = [];
  for (let i = 1; i <= numVoters; i++) {
    voters.push("voter" + i);
    weights.push(toBN(totalWeightSum / numVoters));
  }
  return symbols.map(feed => {
    const prices: BN[] = voters.map((_, i) => toBN(i));
    return calculateResultsForFeed(voters, prices, weights, feed);
  });
}
