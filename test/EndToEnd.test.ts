// Run with
// yarn test test/voting/EndToEnd.test.ts
import BN from "bn.js";
import chai, { expect } from "chai";
import chaiBN from "chai-bn";
import { web3 } from "hardhat";
import { FTSOClient } from "../src/FTSOClient";
import { RandomPriceFeed, RandomPriceFeedConfig } from "../test-utils/utils/RandomPriceFeed";
import { TruffleProvider, TruffleProviderOptions } from "../src/providers/TruffleProvider";
import { Feed } from "../src/voting-interfaces";
import { toBN, unprefixedSymbolBytes } from "../src/voting-utils";
import { getTestFile } from "../test-utils/utils/constants";
import { increaseTimeTo } from "../test-utils/utils/test-helpers";
import {
  DummyERC20Instance,
  ERC20PriceOracleInstance,
  MockContractInstance,
  PriceOracleInstance,
  VoterRegistryInstance,
  VotingContract,
  VotingInstance,
  VotingManagerInstance,
  VotingRewardManagerInstance,
} from "../typechain-truffle";
import {
  moveToCurrentRewardEpochRevealEnd,
  moveToNextPriceEpochStart,
  moveToNextRewardEpochStart,
} from "../test-utils/utils/voting-test-utils";
import { ContractAddresses, loadAccounts } from "../deployment/tasks/common";
import {
  REWARD_VALUE,
  calculateVoteResults,
  claimRewards,
  commit,
  offerRewards,
  preparePrices,
  prepareSymbols,
  publishPriceEpoch,
  reveal,
  signAndSend,
  syncToLastBlock,
} from "./EndToEnd.utils";
import { sleepFor } from "../src/time-utils";

chai.use(chaiBN(BN));

const Voting: VotingContract = artifacts.require("Voting");
const VoterRegistry = artifacts.require("VoterRegistry");
const VotingManager = artifacts.require("VotingManager");
const VotingRewardManager = artifacts.require("VotingRewardManager");
const PriceOracle = artifacts.require("PriceOracle");
const DummyERC20 = artifacts.require("DummyERC20");
const ERC20PriceOracle = artifacts.require("ERC20PriceOracle");
const Mock = artifacts.require("MockContract");

const TOTAL_SUPPLY = REWARD_VALUE.mul(toBN(1000));
const REWARD_EPOCH_DURATION = 5;
const THRESHOLD = 5000;
const INITIAL_MAX_NUMBER_OF_FEEDS = 8;

const MINIMAL_OFFER_VALUE = REWARD_VALUE.div(toBN(2));
const MINIMAL_OFFER_VALUE_PRICE_EXPIRY_SEC = toBN(60 * 1000);
const FEE_PERCENTAGE_UPDATE_OFFSET = 3;
const DEFAULT_FEE_PERCENTAGE = 2000; // 20%

describe(`End to end; ${getTestFile(__filename)}`, async () => {
  const DEFAULT_VOTER_WEIGHT = toBN(1000);
  const DATA_PROVIDER_COUNT = 10;
  const FIRST_REWARD_EPOCH = 1;
  const TOTAL_REWARD_EPOCHS = 3;

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

  let accounts: string[];
  let wallets: any[];
  let symbols: Feed[];

  let ftsoClients: FTSOClient[];
  let initialPriceEpoch: number;

  let priceFeedsForClient: RandomPriceFeed[];

  before(async () => {
    // Getting accounts
    wallets = loadAccounts(web3);
    accounts = wallets.map(wallet => wallet.address);
    governance = accounts[0];

    let now = Math.floor(Date.now() / 1000);
    await increaseTimeTo(now);

    // contract deployments
    votingManager = await VotingManager.new(governance);
    voterRegistry = await VoterRegistry.new(governance, votingManager.address, THRESHOLD);
    voting = await Voting.new(voterRegistry.address, votingManager.address);
    priceOracle = await PriceOracle.new(governance);
    votingRewardManager = await VotingRewardManager.new(
      governance,
      FEE_PERCENTAGE_UPDATE_OFFSET,
      DEFAULT_FEE_PERCENTAGE
    );
    erc20PriceOracle = await ERC20PriceOracle.new(governance);
    mockPriceOracle = await Mock.new();

    // Dummy ERC20 contracts
    dummyCoin1 = await DummyERC20.new("DummyCoin1", "DC1");
    dummyCoin2 = await DummyERC20.new("DummyCoin2", "DC2");
    await dummyCoin1.mint(governance, TOTAL_SUPPLY);
    await dummyCoin2.mint(governance, TOTAL_SUPPLY);
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

    await registerVoters(voterRegistry, toBN(FIRST_REWARD_EPOCH), accounts);

    const currentBlockNumber = await web3.eth.getBlockNumber();

    const priceFeedConfigs: RandomPriceFeedConfig[] = createPriceFeedConfigs(symbols);

    // Initialize FTSO clients with random feeds
    ftsoClients = [];
    for (let i = 1; i <= DATA_PROVIDER_COUNT; i++) {
      const privateKey = wallets[i].privateKey;
      const contracts = {
        voting: voting.address,
        votingRewardManager: votingRewardManager.address,
        voterRegistry: voterRegistry.address,
        priceOracle: priceOracle.address,
        votingManager: votingManager.address,
      } as ContractAddresses;
      const provider = await TruffleProvider.create(contracts, {
        privateKey,
        artifacts,
        web3,
      } as TruffleProviderOptions);

      const client = new FTSOClient(provider, currentBlockNumber);
      priceFeedsForClient = priceFeedConfigs.map(config => new RandomPriceFeed(config));
      client.registerPriceFeeds(priceFeedsForClient);
      client.initializeRewardCalculator(FIRST_REWARD_EPOCH);
      ftsoClients.push(client);
    }
  });

  it(`should mint dummy ERC20 currencies`, async () => {
    for (let coin of [dummyCoin1, dummyCoin2]) {
      const totalSupply = await coin.totalSupply();
      const accountBalance = await coin.balanceOf(governance);
      expect(totalSupply).to.equal(TOTAL_SUPPLY);
      expect(accountBalance).to.equal(TOTAL_SUPPLY);
    }
  });

  it(`should reward epoch be ${FIRST_REWARD_EPOCH - 1}`, async () => {
    const currentRewardEpochId = await votingManager.getCurrentRewardEpochId();
    expect(currentRewardEpochId).to.be.bignumber.equal(toBN(FIRST_REWARD_EPOCH - 1));
  });

  it("should vote powers be set for the reward epoch", async () => {
    const firstPriceEpochInRewardEpoch1 = firstRewardedPriceEpoch.add(toBN(REWARD_EPOCH_DURATION));
    const totalWeight = DEFAULT_VOTER_WEIGHT.mul(toBN(DATA_PROVIDER_COUNT));
    expect(await voterRegistry.totalWeightPerRewardEpoch(FIRST_REWARD_EPOCH)).to.be.bignumber.eq(totalWeight);
    for (let i = 1; i <= DATA_PROVIDER_COUNT; i++) {
      expect(await voting.getVoterWeightForRewardEpoch(accounts[i], firstPriceEpochInRewardEpoch1)).to.be.bignumber.eq(
        DEFAULT_VOTER_WEIGHT
      );
    }
    expect(await voterRegistry.thresholdForRewardEpoch(FIRST_REWARD_EPOCH)).to.be.bignumber.eq(
      totalWeight.mul(toBN(THRESHOLD)).div(toBN(10000))
    );
  });

  it(`should track correct reward offers`, async () => {
    await offerRewards(
      FIRST_REWARD_EPOCH,
      [dummyCoin1, dummyCoin2],
      mockPriceOracle,
      priceOracle,
      ftsoClients,
      symbols,
      votingRewardManager,
      governance,
      accounts.slice(1, 3),
      REWARD_VALUE
    );
  });

  it(`should first price epoch of the first rewarded epoch be set`, async () => {
    await moveToNextRewardEpochStart(votingManager, firstRewardedPriceEpoch, REWARD_EPOCH_DURATION);
    const currentPriceEpochId = await votingManager.getCurrentPriceEpochId();
    const currentRewardEpochId = await votingManager.getCurrentRewardEpochId();
    expect(currentPriceEpochId).to.be.bignumber.equal(firstRewardedPriceEpoch.add(toBN(REWARD_EPOCH_DURATION)));
    expect(currentRewardEpochId).to.be.bignumber.equal(toBN(FIRST_REWARD_EPOCH));
  });

  it("should FTSO clients prepare price feeds for the next price epoch", async () => {
    initialPriceEpoch = (await votingManager.getCurrentPriceEpochId()).toNumber();
    await preparePrices(initialPriceEpoch, ftsoClients, votingManager);
  });

  it("should clients be initialized", async () => {
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
  });

  it("should FTSO client send signed message hash and finalize", async () => {
    await signAndSend(initialPriceEpoch, ftsoClients, votingManager);
  });

  it("should a client publish price feeds for an epoch", async () => {
    await publishPriceEpoch(initialPriceEpoch, ftsoClients[0], symbols, priceOracle);
  });

  it("should run the remaining price epochs in the reward epoch", async () => {
    let priceEpochId = initialPriceEpoch + 1;

    for (let rewardEpoch = FIRST_REWARD_EPOCH; rewardEpoch <= TOTAL_REWARD_EPOCHS; rewardEpoch++) {
      let currentRewardEpoch = await votingManager.getCurrentRewardEpochId();

      await registerVoters(voterRegistry, currentRewardEpoch.addn(1), accounts);

      await offerRewards(
        currentRewardEpoch.addn(1).toNumber(),
        [dummyCoin1, dummyCoin2],
        mockPriceOracle,
        priceOracle,
        ftsoClients,
        symbols,
        votingRewardManager,
        governance,
        accounts.slice(1, 3),
        REWARD_VALUE
      );

      for (; priceEpochId < initialPriceEpoch + REWARD_EPOCH_DURATION * rewardEpoch; priceEpochId++) {
        await preparePrices(priceEpochId, ftsoClients, votingManager);
        await commit(priceEpochId, ftsoClients, votingManager);
        await moveToNextPriceEpochStart(votingManager);
        await reveal(priceEpochId, ftsoClients, votingManager);
        await moveToCurrentRewardEpochRevealEnd(votingManager);
        await calculateVoteResults(priceEpochId, ftsoClients, votingManager);
        await signAndSend(priceEpochId, ftsoClients, votingManager);
        await publishPriceEpoch(priceEpochId, ftsoClients[0], symbols, priceOracle);

        await sleepFor(0); // Allow pending epoch event handlers to complete
      }
      let newRewardEpochId = await votingManager.getCurrentRewardEpochId();

      ftsoClients.forEach(client => client.registerPriceFeeds(priceFeedsForClient));

      await claimRewards(
        votingManager,
        newRewardEpochId.toNumber() - 1,
        ftsoClients,
        priceEpochId - 1,
        governance,
        votingRewardManager,
        [dummyCoin1, dummyCoin2]
      );
    }
  });

  // TODO: test claiming undistributed rewards
  // it("should claim undistributed rewards", async () => {
  // });

  async function registerVoters(voterRegistry: VoterRegistryInstance, rewardEpoch: BN, accounts: string[]) {
    for (let i = 1; i <= DATA_PROVIDER_COUNT; i++) {
      await voterRegistry.registerAsAVoter(rewardEpoch, DEFAULT_VOTER_WEIGHT, { from: accounts[i] });
    }
  }
});

/**
 * All FTSO clients will have the same price feed configs, but each client will have different price feeds
 * due to randomness noise.
 */
function createPriceFeedConfigs(symbols: Feed[]) {
  const priceFeedConfigs: RandomPriceFeedConfig[] = [];
  for (let j = 0; j < symbols.length; j++) {
    const priceFeedConfig = {
      period: 10,
      factor: 1000 * (j + 1),
      variance: 100,
      feedInfo: symbols[j],
    } as RandomPriceFeedConfig;
    priceFeedConfigs.push(priceFeedConfig);
  }
  return priceFeedConfigs;
}
