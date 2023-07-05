// Run with
// yarn test test/voting/EndToEnd.test.ts 
import { expectEvent } from "@openzeppelin/test-helpers";
import BN from "bn.js";
import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import fs from "fs";
import { web3 } from "hardhat";
import { FTSOClient } from "../src/FTSOClient";
import { RandomPriceFeed, RandomPriceFeedConfig } from "../src/price-feeds/RandomPriceFeed";
import { TruffleProvider } from "../src/providers/TruffleProvider";
import { Feed, Offer } from "../src/voting-interfaces";
import { moveToCurrentRewardEpochRevealEnd, moveToNextPriceEpochStart, moveToNextRewardEpochStart } from "../src/voting-test-utils";
import { ZERO_ADDRESS, feedId, hexlifyBN, toBytes4, unprefixedSymbolBytes } from "../src/voting-utils";
import { getTestFile } from "../test-utils/utils/constants";
import { increaseTimeTo, toBN } from "../test-utils/utils/test-helpers";
import { DummyERC20Instance, ERC20PriceOracleInstance, MockContractInstance, PriceOracleInstance, VoterRegistryInstance, VotingInstance, VotingManagerInstance, VotingRewardManagerInstance } from "../typechain-truffle";
chai.use(chaiBN(BN));

const Voting = artifacts.require("Voting");
const VoterRegistry = artifacts.require("VoterRegistry");
const VotingManager = artifacts.require("VotingManager");
const VotingRewardManager = artifacts.require("VotingRewardManager");
const PriceOracle = artifacts.require("PriceOracle");
const DummyERC20 = artifacts.require("DummyERC20");
const ERC20PriceOracle = artifacts.require("ERC20PriceOracle");
const Mock = artifacts.require("MockContract");

const REWARD_OFFER_SYMBOL = "FLR";
const REWARD_QUOTE_SYMBOL = "USD";
const REWARD_VALUE = toBN("1000999");
const REWARD_EPOCH_DURATION = 5;
const THRESHOLD = 5000;
const INITIAL_MAX_NUMBER_OF_FEEDS = 8;
const IQR_SHARE = toBN(700000);
const PCT_SHARE = toBN(300000);
const ELASTIC_BAND_WIDTH_PPM = toBN(50000);
const DEFAULT_REWARD_BELT_PPM = toBN(500000); // 50%
const MINIMAL_OFFER_VALUE = REWARD_VALUE.div(toBN(2));
const MINIMAL_OFFER_VALUE_PRICE_EXPIRY_SEC = toBN(60);

function prepareSymbols(numberOfFeeds: number): Feed[] {
  let symbols = [{ // rewarded feed
    offerSymbol: REWARD_OFFER_SYMBOL,
    quoteSymbol: REWARD_QUOTE_SYMBOL,
  }];
  // Dummy feeds
  for (let i = 1; i < numberOfFeeds; i++) {
    symbols.push({
      offerSymbol: `FL${i}`,
      quoteSymbol: REWARD_QUOTE_SYMBOL,
    });
  }
  return symbols;
}

async function offerRewards(
  rewardEpochId: number, erc20Coins: DummyERC20Instance[], ftsoClients: FTSOClient[], symbols: Feed[],
  votingRewardManager: VotingRewardManagerInstance, governance: string, leadProviders: string[],
  rewardValue: BN,
) {
  for (let coin of erc20Coins) {
    await coin.approve(votingRewardManager.address, rewardValue, { from: governance });
    expect(await coin.allowance(governance, votingRewardManager.address)).to.bignumber.equal(rewardValue);
  }

  let totalAmount = toBN(0);
  let offersSent: Offer[] = [];
  for (let i = 0; i < symbols.length; i++) {
    let amount = rewardValue.add(toBN(i));

    let basicOffer = {
      amount: amount,
      currencyAddress: ZERO_ADDRESS,
      offerSymbol: toBytes4(symbols[i].offerSymbol),
      quoteSymbol: toBytes4(symbols[i].quoteSymbol),
      leadProviders: leadProviders,
      rewardBeltPPM: DEFAULT_REWARD_BELT_PPM,
      flrValue: amount,
      elasticBandWidthPPM: ELASTIC_BAND_WIDTH_PPM,
      iqrSharePPM: IQR_SHARE,
      pctSharePPM: PCT_SHARE,
      remainderClaimer: ZERO_ADDRESS,
    } as Offer;
    if (i < erc20Coins.length) {
      offersSent.push(
        { ...basicOffer, currencyAddress: erc20Coins[i].address, amount: rewardValue },
      );
    } else {
      totalAmount = totalAmount.add(amount);
      offersSent.push(basicOffer);
    }
  }

  await votingRewardManager.offerRewards(hexlifyBN(offersSent), { from: governance, value: totalAmount });

  let balance = await web3.eth.getBalance(votingRewardManager.address);
  expect(balance).to.equal(totalAmount);
  for (let coin of erc20Coins) {
    expect(await votingRewardManager.getNextRewardEpochBalance(coin.address)).to.equal(rewardValue);
    expect(await coin.balanceOf(governance)).to.bignumber.equal(toBN(0));
    expect(await coin.balanceOf(votingRewardManager.address)).to.bignumber.equal(rewardValue);
  }

  for (let client of ftsoClients) {
    await client.processNewBlocks();
    client.registerRewardsForRewardEpoch(rewardEpochId);
    let rewardData: Map<string, Offer[]> = client.rewardCalculator.rewardOffersBySymbol.get(rewardEpochId)!;
    expect([...rewardData.values()].length).to.equal(symbols.length);

    for (let i = 0; i < symbols.length; i++) {
      let offers = rewardData.get(feedId(symbols[i]))!;
      expect(offers.length).to.equal(1);
      if (i == 0 || i == 1) {
        expect(offers[0].amount).to.equal(rewardValue);
      } else {
        expect(offers[0].amount).to.equal(rewardValue.add(toBN(i)));
      }
      expect(offers[0].currencyAddress).to.equal(offersSent[i].currencyAddress);
    }
  }

}

async function syncToLastBlock(ftsoClients: FTSOClient[]) {
  let currentBlockNumber = await web3.eth.getBlockNumber();
  for (let client of ftsoClients) {
    await client.processNewBlocks();
    expect(client.lastProcessedBlockNumber).to.be.equal(currentBlockNumber);
  }
}

async function preparePrices(priceEpochId: number, ftsoClients: FTSOClient[], votingManager: VotingManagerInstance) {
  let currentPriceEpoch = (await votingManager.getCurrentPriceEpochId()).toNumber();
  expect(currentPriceEpoch).to.be.equal(priceEpochId);
  // initialPriceEpoch = currentPriceEpoch;
  for (let client of ftsoClients) {
    client.preparePriceFeedsForPriceEpoch(currentPriceEpoch);
    let numberOfFeeds = client.orderedPriceFeeds(priceEpochId).length;
    let epochData = client.priceEpochData.get(currentPriceEpoch);
    expect(epochData).to.not.be.undefined;
    expect(epochData?.epochId).to.be.equal(currentPriceEpoch);
    expect(epochData?.prices?.length).to.be.equal(numberOfFeeds);
    expect(epochData?.pricesHex?.length! - 2).to.be.equal(numberOfFeeds * 4 * 2);
    expect(epochData?.random?.length).to.be.equal(66);
    expect(epochData?.bitVote).to.be.equal("0x00");
  }
}

async function commit(priceEpochId: number, ftsoClients: FTSOClient[], votingManager: VotingManagerInstance) {
  let currentEpoch = (await votingManager.getCurrentPriceEpochId()).toNumber();
  expect(currentEpoch).to.be.equal(priceEpochId);
  console.log("Commit epoch", currentEpoch)
  for (let client of ftsoClients) {
    await client.onCommit(currentEpoch);
  }
  for (let client of ftsoClients) {
    await client.processNewBlocks();
    expect(client.priceEpochCommits.get(currentEpoch)?.size).to.be.equal(ftsoClients.length);
  }
}

async function reveal(priceEpochId: number, ftsoClients: FTSOClient[], votingManager: VotingManagerInstance) {
  let revealEpoch = (await votingManager.getCurrentPriceEpochId()).toNumber() - 1;
  expect(revealEpoch).to.be.equal(priceEpochId);
  console.log("Reveal epoch", revealEpoch);
  for (let client of ftsoClients) {
    await client.onReveal(revealEpoch);
  }
  for (let client of ftsoClients) {
    await client.processNewBlocks();
    expect(client.priceEpochReveals.get(revealEpoch)?.size).to.be.equal(ftsoClients.length);
  }
}

async function calculateVoteResults(priceEpochId: number, ftsoClients: FTSOClient[], votingManager: VotingManagerInstance) {
  let calculatePriceEpochId = (await votingManager.getCurrentPriceEpochId()).toNumber() - 1;
  expect(calculatePriceEpochId).to.be.greaterThanOrEqual(priceEpochId);
  console.log("Calculate vote results for epoch", calculatePriceEpochId);
  let finalMedianPrice = [];
  let quartile1Price = [];
  let quartile3Price = [];

  for (let client of ftsoClients) {
    await client.calculateResults(calculatePriceEpochId);
    let data = client.priceEpochResults.get(calculatePriceEpochId)!;
    finalMedianPrice.push(data.medianData.map(res => res.data.finalMedianPrice));
    quartile1Price.push(data.medianData.map(res => res.data.quartile1Price));
    quartile3Price.push(data.medianData.map(res => res.data.quartile3Price));
  }

  let feedNumbers = new Set<number>(ftsoClients.map(client => client.orderedPriceFeeds(priceEpochId).length));
  expect(feedNumbers.size).to.be.equal(1);
  let numberOfFeeds = ftsoClients[0].orderedPriceFeeds(priceEpochId).length;
  for (let i = 0; i < ftsoClients.length - 1; i++) {
    for (let j = 0; j < numberOfFeeds; j++) {
      expect(finalMedianPrice[i][j]).to.be.equal(finalMedianPrice[i + 1][j])
      expect(quartile1Price[i][j]).to.be.equal(quartile1Price[i + 1][j])
      expect(quartile3Price[i][j]).to.be.equal(quartile3Price[i + 1][j])
    }
  }
  for (let j = 0; j < numberOfFeeds; j++) {
    console.log(`\t${quartile1Price[0][j]}\t${finalMedianPrice[0][j]}\t${quartile3Price[0][j]}`);
  }

  let client = ftsoClients[0];
  let rewards = client.priceEpochResults.get(calculatePriceEpochId)?.rewards;
  let rewardMap = new Map<string, BN>();
  for (let rewardClaims of rewards!.values()) {
    for (let rewardClaim of rewardClaims) {
      let rewardValue = rewardMap.get(rewardClaim.claimRewardBody?.currencyAddress!) ?? toBN(0);
      rewardMap.set(rewardClaim.claimRewardBody?.currencyAddress!, rewardValue.add(rewardClaim.claimRewardBody?.amount!));
    }
  }
}

async function signAndSend(priceEpochId: number, ftsoClients: FTSOClient[], votingManager: VotingManagerInstance) {
  let currentEpochId = (await votingManager.getCurrentPriceEpochId()).toNumber();
  expect(currentEpochId - 1).to.be.greaterThanOrEqual(priceEpochId);
  // TODO: check the timing is correct, after the reveal period
  for (let client of ftsoClients) {
    await client.onSign(priceEpochId, true); // skip calculation, since we already did it
  }
  let client = ftsoClients[0];
  await client.processNewBlocks();
  let signaturesTmp = [...client.priceEpochSignatures.get(priceEpochId)!.values()];
  let merkleRoots = [...(new Set(signaturesTmp.map(sig => sig.merkleRoot))).values()];
  let merkleRoot = merkleRoots[0];
  expect(merkleRoots.length).to.be.equal(1);
  let receipt = await client.onSendSignaturesForMyMerkleRoot(priceEpochId);
  console.log(`Finalize gas used: ${receipt.receipt.gasUsed}`);
  expectEvent(receipt, "MerkleRootConfirmed", { epochId: toBN(priceEpochId), merkleRoot });
}

async function publishPriceEpoch(priceEpochId: number, client: FTSOClient, symbols: Feed[], priceOracle: PriceOracleInstance) {
  let receipt = await client.publishPrices(priceEpochId, [...symbols.keys()]);

  for (let i = 0; i < symbols.length; i++) {
    let medianData = client.priceEpochResults.get(priceEpochId)!.medianData.find(x => x.feed.offerSymbol === symbols[i].offerSymbol);
    let result = await priceOracle.anchorPrices("0x" + unprefixedSymbolBytes(symbols[i]));

    expectEvent(receipt, "PriceFeedPublished", {
      offerSymbol: web3.utils.padRight(toBytes4(symbols[i].offerSymbol), 64),
      quoteSymbol: web3.utils.padRight(toBytes4(symbols[i].quoteSymbol), 64),
      priceEpochId: toBN(priceEpochId),
      price: toBN(medianData!.data.finalMedianPrice),
      timestamp: toBN((result as any).timestamp),
    });

    expect((result as any).price).to.be.bignumber.equal(toBN(medianData!.data.finalMedianPrice));
  }
}

describe(`End to end; ${getTestFile(__filename)}`, async () => {
  let voting: VotingInstance;
  let voterRegistry: VoterRegistryInstance;
  let votingManager: VotingManagerInstance;
  let votingRewardManager: VotingRewardManagerInstance;
  let priceOracle: PriceOracleInstance;
  let erc20PriceOracle: ERC20PriceOracleInstance;
  let mockPriceOracle: MockContractInstance;


  let dummyCoin1: DummyERC20Instance;
  let dummyCoin2: DummyERC20Instance;

  let governance: string;
  let firstRewardedPriceEpoch: BN;

  let WEIGHT = toBN(1000);

  let firstEpochStartSec: BN;
  let epochDurationSec: BN;
  let N = 10;
  let accounts: string[];
  let wallets: any[];
  let symbols: Feed[];

  let ftsoClients: FTSOClient[];
  let initialPriceEpoch: number;
  const TEST_REWARD_EPOCH = 1;

  before(async () => {

    // Getting accounts
    wallets = JSON.parse(fs.readFileSync("./test-1020-accounts.json").toString()).map((x: any) => web3.eth.accounts.privateKeyToAccount(x.privateKey));
    accounts = wallets.map((wallet) => wallet.address);
    governance = accounts[0];

    let now = Math.floor(Date.now() / 1000);
    await increaseTimeTo(now);

    // contract deployments
    votingManager = await VotingManager.new(governance);
    voterRegistry = await VoterRegistry.new(governance, votingManager.address, THRESHOLD);
    voting = await Voting.new(voterRegistry.address, votingManager.address);
    priceOracle = await PriceOracle.new(governance);
    votingRewardManager = await VotingRewardManager.new(governance);
    erc20PriceOracle = await ERC20PriceOracle.new(governance);
    mockPriceOracle = await Mock.new();

    // Dummy ERC20 contracts
    dummyCoin1 = await DummyERC20.new("DummyCoin1", "DC1");
    dummyCoin2 = await DummyERC20.new("DummyCoin2", "DC2");
    await dummyCoin1.mint(governance, REWARD_VALUE);
    await dummyCoin2.mint(governance, REWARD_VALUE);

    // Reward epoch configuration
    firstRewardedPriceEpoch = await votingManager.getCurrentPriceEpochId();
    await votingManager.configureRewardEpoch(firstRewardedPriceEpoch, REWARD_EPOCH_DURATION);
    await votingManager.configureSigningDuration(180);

    // Feed symbols
    symbols = prepareSymbols(INITIAL_MAX_NUMBER_OF_FEEDS);

    // ERC20 price oracle configuration
    await erc20PriceOracle.setPriceOracle(mockPriceOracle.address);
    await erc20PriceOracle.setERC20Settings(dummyCoin1.address, "0x" + unprefixedSymbolBytes(symbols[0]));
    await erc20PriceOracle.setERC20Settings(dummyCoin2.address, "0x" + unprefixedSymbolBytes(symbols[1]));

    // Reward manager configuration
    await votingRewardManager.setVoting(voting.address);
    await votingRewardManager.setVotingManager(votingManager.address);
    await votingRewardManager.setERC20PriceOracle(erc20PriceOracle.address);
    await votingRewardManager.setMinimalOfferParameters(MINIMAL_OFFER_VALUE, MINIMAL_OFFER_VALUE_PRICE_EXPIRY_SEC);

    // price oracle configuration
    await priceOracle.setVotingManager(votingManager.address);
    await priceOracle.setVoting(voting.address);


    // vote time configuration
    firstEpochStartSec = await votingManager.BUFFER_TIMESTAMP_OFFSET();
    epochDurationSec = await votingManager.BUFFER_WINDOW();

    // Initialize weights for reward epoch 1
    for (let i = 1; i <= N; i++) {
      console.log("Account:", accounts[i]);
      await voterRegistry.addVoterWeightForRewardEpoch(accounts[i], TEST_REWARD_EPOCH, WEIGHT);
    }

    ftsoClients = [];
    let currentBlockNumber = await web3.eth.getBlockNumber();

    // initialize price feed configs
    // all FTSO clients will have the same price feed configs.
    // though, each client will have different price feeds due to randomness noise
    let priceFeedConfigs: RandomPriceFeedConfig[] = [];
    for (let j = 0; j < INITIAL_MAX_NUMBER_OF_FEEDS; j++) {
      let priceFeedConfig = {
        period: 10,
        factor: 1000 * (j + 1),
        variance: 100,
        feedInfo: symbols[j]
      } as RandomPriceFeedConfig;
      priceFeedConfigs.push(priceFeedConfig);
    }


    // Initialize FTSO clients with random feeds
    for (let i = 1; i <= N; i++) {
      // initialize provider
      let provider = new TruffleProvider(
        voting.address,
        votingRewardManager.address,
        voterRegistry.address,
        priceOracle.address,
        votingManager.address,
      );
      await provider.initialize({ privateKey: wallets[i].privateKey });
      let client = new FTSOClient(provider);

      await client.initialize(currentBlockNumber, undefined, web3);
      // generate price feeds for the client
      let priceFeedsForClient = priceFeedConfigs.map(config => new RandomPriceFeed(config));
      client.registerPriceFeeds(priceFeedsForClient);
      // initialize reward calculator for the client
      client.initializeRewardCalculator(TEST_REWARD_EPOCH);
      ftsoClients.push(client);
    }
  });

  it(`should mint dummy ERC20 currencies`, async () => {
    for (let coin of [dummyCoin1, dummyCoin2]) {
      let totalSupply = await coin.totalSupply();
      let accountBalance = await coin.balanceOf(governance);
      expect(totalSupply).to.equal(REWARD_VALUE);
      expect(accountBalance).to.equal(REWARD_VALUE);
    }
  })

  it(`should reward epoch be ${TEST_REWARD_EPOCH - 1}`, async () => {
    let currentRewardEpochId = await votingManager.getCurrentRewardEpochId();
    expect(currentRewardEpochId).to.be.bignumber.equal(toBN(TEST_REWARD_EPOCH - 1));
  })

  it("should vote powers be set for the reward epoch", async () => {
    // let rewardEpochId = await votingManager.getCurrentRewardEpochId();
    // let currentEpoch = await votingManager.getCurrentPriceEpochId();
    let firstPriceEpochInRewardEpoch1 = firstRewardedPriceEpoch.add(toBN(REWARD_EPOCH_DURATION));
    let totalWeight = WEIGHT.mul(toBN(N));
    expect(await voterRegistry.totalWeightPerRewardEpoch(TEST_REWARD_EPOCH)).to.be.bignumber.eq(totalWeight);
    for (let i = 1; i <= N; i++) {
      expect(await voting.getVoterWeightForEpoch(accounts[i], firstPriceEpochInRewardEpoch1)).to.be.bignumber.eq(WEIGHT);
    }
    expect(await voterRegistry.thresholdForRewardEpoch(TEST_REWARD_EPOCH)).to.be.bignumber.eq(totalWeight.mul(toBN(THRESHOLD)).div(toBN(10000)));
  });

  it(`should track correct reward offers`, async () => {
    // Configure mock price oracle to return the correct values for first two symbols
    let now = Math.floor(Date.now() / 1000) - 2;
    mockPriceOracle.givenMethodReturn(priceOracle.contract.methods.lastAnchorPriceForSymbol("0x" + unprefixedSymbolBytes(symbols[0])).encodeABI(), web3.eth.abi.encodeParameters(["uint32", "uint32"], [REWARD_VALUE, now]));
    mockPriceOracle.givenMethodReturn(priceOracle.contract.methods.lastAnchorPriceForSymbol("0x" + unprefixedSymbolBytes(symbols[1])).encodeABI(), web3.eth.abi.encodeParameters(["uint32", "uint32"], [REWARD_VALUE, now]));

    await offerRewards(
      TEST_REWARD_EPOCH, [dummyCoin1, dummyCoin2], ftsoClients, symbols,
      votingRewardManager, governance, accounts.slice(1, 3), REWARD_VALUE
    );
  });

  it(`should first price epoch of the first rewarded epoch be set`, async () => {
    await moveToNextRewardEpochStart(votingManager, firstRewardedPriceEpoch, REWARD_EPOCH_DURATION);
    let currentPriceEpochId = await votingManager.getCurrentPriceEpochId();
    let currentRewardEpochId = await votingManager.getCurrentRewardEpochId();
    expect(currentPriceEpochId).to.be.bignumber.equal(firstRewardedPriceEpoch.add(toBN(REWARD_EPOCH_DURATION)));
    expect(currentRewardEpochId).to.be.bignumber.equal(toBN(TEST_REWARD_EPOCH));
  });

  it("should FTSO clients prepare price feeds for the next price epoch", async () => {
    initialPriceEpoch = (await votingManager.getCurrentPriceEpochId()).toNumber();
    await preparePrices(initialPriceEpoch, ftsoClients, votingManager);
  });

  it("should clients be initialized", async () => {
    // ftsoClients[0].setVerbose(true);
    await syncToLastBlock(ftsoClients);
  });

  it("should all FTSO clients commit and events should be registered", async () => {
    await commit(initialPriceEpoch, ftsoClients, votingManager);
  });

  it("should all FTSO clients reveal and events should be registered", async () => {
    await moveToNextPriceEpochStart(votingManager);
    await reveal(initialPriceEpoch, ftsoClients, votingManager);
  });

  it("should calculate vote results", async () => {
    await moveToCurrentRewardEpochRevealEnd(votingManager);
    await calculateVoteResults(initialPriceEpoch, ftsoClients, votingManager);
  })

  it("should FTSO client send signed message hash and finalize", async () => {
    await signAndSend(initialPriceEpoch, ftsoClients, votingManager);
  });

  it("should a client publish price feeds for an epoch", async () => {
    await publishPriceEpoch(initialPriceEpoch, ftsoClients[0], symbols, priceOracle);
  });

  it("should run the remaining price epochs in the reward epoch", async () => {
    // let currentRewardEpochId = await votingManager.getCurrentRewardEpochId();
    for (let priceEpochId = initialPriceEpoch + 1; priceEpochId < initialPriceEpoch + REWARD_EPOCH_DURATION; priceEpochId++) {
      console.log("Price epoch", priceEpochId);
      await preparePrices(priceEpochId, ftsoClients, votingManager);
      await commit(priceEpochId, ftsoClients, votingManager);
      await moveToNextPriceEpochStart(votingManager);
      await reveal(priceEpochId, ftsoClients, votingManager);
      await moveToCurrentRewardEpochRevealEnd(votingManager);
      await calculateVoteResults(priceEpochId, ftsoClients, votingManager);
      await signAndSend(priceEpochId, ftsoClients, votingManager);
      await publishPriceEpoch(priceEpochId, ftsoClients[0], symbols, priceOracle);
    }
    let newRewardEpochId = await votingManager.getCurrentRewardEpochId();
    let currentPriceEpochId = await votingManager.getCurrentPriceEpochId();
    console.log("Initial price epoch", initialPriceEpoch);
    console.log("Current reward epoch", newRewardEpochId.toNumber());
    console.log("Current price epoch", currentPriceEpochId.toNumber());
  });

  it("should claim rewards when available", async () => {
    // By checking each client, we not only test the correctness of the behavior of claimReward(),
    // but also the correctness of the construction of the Merkle proof in all possible cases.

    let currentRewardEpochId = await votingManager.getCurrentRewardEpochId();
    console.log("Current reward epoch", currentRewardEpochId.toNumber());
    expect(currentRewardEpochId.toNumber()).to.be.equal(TEST_REWARD_EPOCH + 1);
    for (let client of ftsoClients) {
      let originalBalance = toBN(await web3.eth.getBalance(client.address));

      let rewardClaims = client.priceEpochResults.get(initialPriceEpoch + REWARD_EPOCH_DURATION - 1)?.rewards?.get(client.address.toLowerCase());
      let receipts = await client.claimReward(TEST_REWARD_EPOCH);
      let txFee = toBN(0);
      for (let receipt of receipts) {
        txFee = txFee.add(toBN(receipt.receipt.gasUsed).mul(toBN(receipt.receipt.effectiveGasPrice)));
      }
      let finalBalance = toBN(await web3.eth.getBalance(client.address));
      if (rewardClaims === undefined || rewardClaims.length === 0) {
        expect(receipts.length).to.be.equal(0);
        expect(finalBalance).to.be.bignumber.equal(originalBalance);
      } else {
        let flrClaim = rewardClaims.find(claim => claim.claimRewardBody?.currencyAddress === ZERO_ADDRESS);
        if (flrClaim !== undefined) {
          let rewardValue = flrClaim.claimRewardBody?.amount;
          expect(rewardValue).to.be.bignumber.equal(finalBalance.sub(originalBalance).add(txFee));
        } else {
          expect(finalBalance).to.be.bignumber.equal(originalBalance.sub(txFee));
        }
        // Check the erc20 claims
        for (let claim of rewardClaims) {
          if (claim.claimRewardBody?.currencyAddress === ZERO_ADDRESS) {
            continue;
          }
          let rewardValue = claim.claimRewardBody?.amount;
          let erc20Contract = await DummyERC20.at(claim.claimRewardBody?.currencyAddress!);
          expect(await erc20Contract.balanceOf(client.address)).to.be.bignumber.equal(rewardValue);
        }
      }
    };

    // Check the balance of the reward manager
    for (let coin of [dummyCoin1, dummyCoin2]) {
      expect(await coin.balanceOf(votingRewardManager.address)).to.be.bignumber.equal(toBN(0));
    }
    expect(await web3.eth.getBalance(votingRewardManager.address)).to.be.bignumber.equal(toBN(0));
  });

});
