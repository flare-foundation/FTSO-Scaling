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
import { ZERO_ADDRESS, feedId, moveToNextEpochStart, toBytes4 } from "../src/voting-utils";
import { getTestFile } from "../test-utils/utils/constants";
import { increaseTimeTo, toBN } from "../test-utils/utils/test-helpers";
import { DummyERC20Instance, PriceOracleInstance, VoterRegistryInstance, VotingInstance, VotingManagerInstance, VotingRewardManagerInstance } from "../typechain-truffle";
chai.use(chaiBN(BN));

const Voting = artifacts.require("Voting");
const VoterRegistry = artifacts.require("VoterRegistry");
const VotingManager = artifacts.require("VotingManager");
const VotingRewardManager = artifacts.require("VotingRewardManager");
const PriceOracle = artifacts.require("PriceOracle");
const DummyERC20 = artifacts.require("DummyERC20");

describe(`End to end; ${getTestFile(__filename)}`, async () => {
  let voting: VotingInstance;
  let voterRegistry: VoterRegistryInstance;
  let votingManager: VotingManagerInstance;
  let votingRewardManager: VotingRewardManagerInstance;
  let priceOracle: PriceOracleInstance;

  let dummyCoin1: DummyERC20Instance;
  let dummyCoin2: DummyERC20Instance;

  let governance: string;
  let firstRewardedPriceEpoch: BN;
  const REWARD_OFFER_SYMBOL = "FLR";
  const REWARD_QUOTE_SYMBOL = "USD";
  const REWARD_VALUE = toBN("1000999");
  const REWARD_EPOCH_DURATION = 10;
  const THRESHOLD = 5000;
  const NUMBER_OF_FEEDS = 8;
  const IQR_SHARE = toBN(70);
  const PCT_SHARE = toBN(30);
  const DEFAULT_REWARD_BELT_PPM = toBN(500000); // 50%

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
    symbols = [{ // rewarded feed
      offerSymbol: REWARD_OFFER_SYMBOL,
      quoteSymbol: REWARD_QUOTE_SYMBOL,
    }];
    // Dummy feeds
    for (let i = 1; i < NUMBER_OF_FEEDS; i++) {
      symbols.push({
        offerSymbol: `FL${i}`,
        quoteSymbol: REWARD_QUOTE_SYMBOL,
      });
    }

    // Reward manager configuration
    await votingRewardManager.setVoting(voting.address);
    await votingRewardManager.setVotingManager(votingManager.address);

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
    for (let j = 0; j < NUMBER_OF_FEEDS; j++) {
      let priceFeedConfig = {
        period: 10,
        factor: 1000 * (j + 1),
        variance: 100,
        feedInfo: symbols[j]
      } as RandomPriceFeedConfig;
      priceFeedConfigs.push(priceFeedConfig);
    }

    let provider = new TruffleProvider(
      voting.address,
      votingRewardManager.address,
      voterRegistry.address,
      priceOracle.address,
      votingManager.address,
    );
    await provider.initialize();

    // Initialize FTSO clients with 
    for (let i = 1; i <= N; i++) {
      let client = new FTSOClient(wallets[i].privateKey, provider);
      await client.initialize(currentBlockNumber, undefined, web3);
      // generate price feeds for the client
      let priceFeedsForClient = priceFeedConfigs.map(config => new RandomPriceFeed(config));
      client.registerPriceFeeds(priceFeedsForClient);
      // initialize reward calculator for the client
      client.initializeRewardCalculator(firstRewardedPriceEpoch.toNumber(), REWARD_EPOCH_DURATION, TEST_REWARD_EPOCH, IQR_SHARE, PCT_SHARE);
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
    for (let coin of [dummyCoin1, dummyCoin2]) {
      await coin.approve(votingRewardManager.address, REWARD_VALUE);
      expect(await coin.allowance(governance, votingRewardManager.address)).to.bignumber.equal(REWARD_VALUE);
    }

    let totalAmount = toBN(0);
    let offersSent: Offer[] = [];
    for (let i = 0; i < symbols.length; i++) {
      let amount = REWARD_VALUE.add(toBN(i));

      let basicOffer = {
        amount: amount,
        currencyAddress: ZERO_ADDRESS,
        offerSymbol: toBytes4(symbols[i].offerSymbol),
        quoteSymbol: toBytes4(symbols[i].quoteSymbol),
        trustedProviders: [accounts[1]],
        rewardBeltPPM: DEFAULT_REWARD_BELT_PPM,
        flrValue: amount,
      } as Offer
      if (i == 0) {
        offersSent.push(
          { ...basicOffer, currencyAddress: dummyCoin1.address, amount: REWARD_VALUE },
        );
      } else if (i == 1) {
        offersSent.push(
          { ...basicOffer, currencyAddress: dummyCoin2.address, amount: REWARD_VALUE },
        );
      } else {
        totalAmount = totalAmount.add(amount);
        offersSent.push(basicOffer);
      }
    }

    await ftsoClients[0].provider.offerRewards(offersSent);

    let balance = await web3.eth.getBalance(votingRewardManager.address);
    expect(balance).to.equal(totalAmount);
    for (let coin of [dummyCoin1, dummyCoin2]) {
      expect(await votingRewardManager.getNextRewardEpochBalance(coin.address)).to.equal(REWARD_VALUE);
      expect(await coin.balanceOf(governance)).to.bignumber.equal(toBN(0));
      expect(await coin.balanceOf(votingRewardManager.address)).to.bignumber.equal(REWARD_VALUE);
    }

    for (let client of ftsoClients) {
      await client.processNewBlocks();
      client.registerRewardsForRewardEpoch(TEST_REWARD_EPOCH);
      let rewardData: Map<string, Offer[]> = client.rewardCalculator.rewardOffersBySymbol.get(TEST_REWARD_EPOCH)!;
      expect([...rewardData.values()].length).to.equal(symbols.length);

      for (let i = 0; i < symbols.length; i++) {
        let offers = rewardData.get(feedId(symbols[i]))!;
        expect(offers.length).to.equal(1);
        if (i == 0 || i == 1) {
          expect(offers[0].amount).to.equal(REWARD_VALUE);
        } else {
          expect(offers[0].amount).to.equal(REWARD_VALUE.add(toBN(i)));
        }
        expect(offers[0].currencyAddress).to.equal(offersSent[i].currencyAddress);
      }
    }
  });

  it(`should first price epoch of the first rewarded epoch be set`, async () => {
    await moveToNextEpochStart(votingManager, firstRewardedPriceEpoch, REWARD_EPOCH_DURATION);
    let currentPriceEpochId = await votingManager.getCurrentPriceEpochId();
    let currentRewardEpochId = await votingManager.getCurrentRewardEpochId();
    expect(currentPriceEpochId).to.be.bignumber.equal(firstRewardedPriceEpoch.add(toBN(REWARD_EPOCH_DURATION)));
    expect(currentRewardEpochId).to.be.bignumber.equal(toBN(TEST_REWARD_EPOCH));
  });

  it("should FTSO clients prepare price feeds for the next price epoch", async () => {
    let currentPriceEpoch = (await votingManager.getCurrentPriceEpochId()).toNumber();
    initialPriceEpoch = currentPriceEpoch;
    for (let client of ftsoClients) {
      client.preparePriceFeedsForPriceEpoch(currentPriceEpoch);
      let epochData = client.priceEpochData.get(currentPriceEpoch);
      expect(epochData).to.not.be.undefined;
      expect(epochData?.epochId).to.be.equal(currentPriceEpoch);
      expect(epochData?.prices?.length).to.be.equal(NUMBER_OF_FEEDS);
      expect(epochData?.pricesHex?.length! - 2).to.be.equal(NUMBER_OF_FEEDS * 4 * 2);
      expect(epochData?.random?.length).to.be.equal(66);
      expect(epochData?.bitVote).to.be.equal("0x00");
    }
  });

  it("should clients be initialized", async () => {
    // ftsoClients[0].setVerbose(true);
    let currentBlockNumber = await web3.eth.getBlockNumber();
    for (let client of ftsoClients) {
      await client.processNewBlocks();
      expect(client.lastProcessedBlockNumber).to.be.equal(currentBlockNumber);
    }
  });

  it("should all FTSO clients commit and events should be registered", async () => {
    let currentEpoch = (await votingManager.getCurrentPriceEpochId()).toNumber();
    console.log("Commit epoch", currentEpoch)
    for (let client of ftsoClients) {
      await client.onCommit(currentEpoch);
    }
    for (let client of ftsoClients) {
      await client.processNewBlocks();
      expect(client.priceEpochCommits.get(currentEpoch)?.size).to.be.equal(N);
    }
  });

  it("should all FTSO clients reveal and events should be registered", async () => {
    await moveToNextEpochStart(votingManager);
    let revealEpoch = (await votingManager.getCurrentPriceEpochId()).toNumber() - 1;
    console.log("Reveal epoch", revealEpoch);
    for (let client of ftsoClients) {
      await client.onReveal(revealEpoch);
    }
    for (let client of ftsoClients) {
      await client.processNewBlocks();
      expect(client.priceEpochReveals.get(revealEpoch)?.size).to.be.equal(N);
    }
    // console.log(ftsoClients[0].epochReveals.get(revealEpoch));
  });

  it("should calculate vote results", async () => {
    await moveToNextEpochStart(votingManager);
    let calculateEpoch = (await votingManager.getCurrentPriceEpochId()).toNumber() - 2;
    console.log("Calculate vote results for epoch", calculateEpoch);
    let finalMedianPrice = [];
    let quartile1Price = [];
    let quartile3Price = [];
    let lowElasticBandPrice = [];
    let highElasticBandPrice = [];

    for (let client of ftsoClients) {
      await client.calculateResults(calculateEpoch);
      let data = client.priceEpochResults.get(calculateEpoch)!;
      finalMedianPrice.push(data.medianData.map(res => res.data.finalMedianPrice));
      quartile1Price.push(data.medianData.map(res => res.data.quartile1Price));
      quartile3Price.push(data.medianData.map(res => res.data.quartile3Price));
      lowElasticBandPrice.push(data.medianData.map(res => res.data.lowElasticBandPrice));
      highElasticBandPrice.push(data.medianData.map(res => res.data.highElasticBandPrice));
    }

    for (let i = 0; i < N - 1; i++) {
      for (let j = 0; j < NUMBER_OF_FEEDS; j++) {
        expect(finalMedianPrice[i][j]).to.be.equal(finalMedianPrice[i + 1][j])
        expect(quartile1Price[i][j]).to.be.equal(quartile1Price[i + 1][j])
        expect(quartile3Price[i][j]).to.be.equal(quartile3Price[i + 1][j])
        expect(lowElasticBandPrice[i][j]).to.be.equal(lowElasticBandPrice[i + 1][j])
        expect(highElasticBandPrice[i][j]).to.be.equal(highElasticBandPrice[i + 1][j])
      }
    }
    for (let j = 0; j < NUMBER_OF_FEEDS; j++) {
      console.log(`\t${lowElasticBandPrice[0][j]}\t${quartile1Price[0][j]}\t${finalMedianPrice[0][j]}\t${quartile3Price[0][j]}\t${highElasticBandPrice[0][j]}`);
    }

  })

  it("should FTSO client send signed message hash and finalize", async () => {
    for (let client of ftsoClients) {
      await client.onSign(initialPriceEpoch);
    }
    let client = ftsoClients[0];
    await client.processNewBlocks();
    let signaturesTmp = [...client.priceEpochSignatures.get(initialPriceEpoch)!.values()];
    let merkleRoots = [...(new Set(signaturesTmp.map(sig => sig.merkleRoot))).values()];
    let merkleRoot = merkleRoots[0];
    expect(merkleRoots.length).to.be.equal(1);
    let receipt = await client.onSendSignaturesForMyMerkleRoot(initialPriceEpoch);
    console.log(`Finalize gas used: ${receipt.receipt.gasUsed}`);
    expectEvent(receipt, "MerkleRootConfirmed", { epochId: toBN(initialPriceEpoch), merkleRoot });
  });

  it("should a client publish price feeds for an epoch", async () => {
    let client = ftsoClients[0];
    let receipt = await client.publishPrices(initialPriceEpoch, [...Array(NUMBER_OF_FEEDS).keys()]);
    // console.log(receipt.logs);
    for (let i = 0; i < NUMBER_OF_FEEDS; i++) {
      // console.dir(receipt.logs[0].args)
      expectEvent(receipt, "PriceFeedPublished", {
        priceEpochId: toBN(initialPriceEpoch),
        // offerSymbol: toBytes4(symbols[i].offerSymbol),
        // quoteSymbol: toBytes4(symbols[i].quoteSymbol),
        price: toBN(client.priceEpochResults.get(initialPriceEpoch)!.medianData[i].data.finalMedianPrice)
      });
    }
  });

  it("should claim rewards when available", async () => {
    // By checking each client, we not only test the correctness of the behavior of claimReward(),
    // but also the correctness of the construction of the Merkle proof in all possible cases.
    let currentRewardEpochId = await votingManager.getCurrentRewardEpochId();
    console.log("Current reward epoch", currentRewardEpochId.toNumber());
    for (let client of ftsoClients) {
      let originalBalance = toBN(await web3.eth.getBalance(client.wallet.address));
      let rewardClaims = client.priceEpochResults.get(initialPriceEpoch)?.rewards?.get(client.wallet.address.toLowerCase());
      if (rewardClaims === undefined) {
        let response = await client.claimReward(initialPriceEpoch);
        let finalBalance = toBN(await web3.eth.getBalance(client.wallet.address));
        expect(response).to.be.null;
        expect(finalBalance).to.be.bignumber.equal(originalBalance);
        continue;
      }

      for (let claim of rewardClaims) {
        let rewardValue = claim.claimRewardBody?.amount;
        console.log("Claiming reward", rewardValue.toString());
        let response = await client.claimReward(initialPriceEpoch);
        let finalBalance = toBN(await web3.eth.getBalance(client.wallet.address));
        expect(response).not.to.be.null;
        expect(rewardValue).to.be.bignumber.equal(finalBalance.sub(originalBalance));
      }
    };
  });

});
