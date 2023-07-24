import { Feed } from "../../src/voting-interfaces";
import { unprefixedSymbolBytes } from "../../src/voting-utils";
import { Account } from "web3-core";
import { FTSOParameters } from "../config/FTSOParameters";
import {
  ERC20PriceOracleInstance,
  PriceOracleInstance,
  VotingInstance,
  VotingManagerInstance,
  VotingRewardManagerInstance,
} from "../../typechain-truffle";
import { writeFileSync } from "fs";
import { DeployedContracts, OUTPUT_FILE } from "./common";
import { Artifacts, HardhatRuntimeEnvironment } from "hardhat/types";

// TODO: extract constants to config
const REWARD_VALUE = 1000999;
export const REWARD_EPOCH_DURATION_PRICE_EPOCHS = 3;
const THRESHOLD = 5000;
const MINIMAL_OFFER_VALUE = Math.trunc(REWARD_VALUE / 2);
const MINIMAL_OFFER_VALUE_PRICE_EXPIRY_SEC = 60;
const FEE_PERCENTAGE_UPDATE_OFFSET = 3;
const DEFAULT_FEE_PERCENTAGE = 2000; // 20%

export async function deployContracts(hre: HardhatRuntimeEnvironment, parameters: FTSOParameters) {
  const artifacts = hre.artifacts;
  const governance = web3.eth.accounts.privateKeyToAccount(parameters.governancePrivateKey);

  const votingManager = await deployVotingManager(artifacts, governance);
  const voterRegistry = await artifacts
    .require("VoterRegistry")
    .new(governance.address, votingManager.address, THRESHOLD);
  const voting = await artifacts.require("Voting").new(voterRegistry.address, votingManager.address);

  const priceOracle = await deployPriceOracle(artifacts, governance, votingManager, voting);
  const erc20PriceOracle = await deployERC20PriceOracle(artifacts, governance, parameters.symbols, priceOracle);

  const votingRewardManager = await deployVotingRewardManager(
    artifacts,
    governance,
    voting,
    votingManager,
    erc20PriceOracle
  );

  const deployed = <DeployedContracts>{
    votingManager,
    voterRegistry,
    voting,
    votingRewardManager,
    priceOracle,
  };

  outputAddresses(deployed);

  console.log("Deployed all contracts");
  return deployed;
}

async function deployPriceOracle(
  artifacts: Artifacts,
  governance: Account,
  votingManager: VotingManagerInstance,
  voting: VotingInstance
) {
  const priceOracle = await artifacts.require("PriceOracle").new(governance.address);
  await priceOracle.setVotingManager(votingManager.address);
  await priceOracle.setVoting(voting.address);
  return priceOracle;
}

async function deployVotingRewardManager(
  artifacts: Artifacts,
  governance: Account,
  voting: VotingInstance,
  votingManager: VotingManagerInstance,
  erc20PriceOracle: ERC20PriceOracleInstance
): Promise<VotingRewardManagerInstance> {
  const votingRewardManager = await artifacts
    .require("VotingRewardManager")
    .new(governance.address, FEE_PERCENTAGE_UPDATE_OFFSET, DEFAULT_FEE_PERCENTAGE);

  await votingRewardManager.setVoting(voting.address);
  await votingRewardManager.setVotingManager(votingManager.address);
  await votingRewardManager.setERC20PriceOracle(erc20PriceOracle.address);
  await votingRewardManager.setMinimalOfferParameters(MINIMAL_OFFER_VALUE, MINIMAL_OFFER_VALUE_PRICE_EXPIRY_SEC);
  return votingRewardManager;
}

async function deployERC20PriceOracle(
  artifacts: Artifacts,
  governance: Account,
  symbols: Feed[],
  priceOracle: PriceOracleInstance
): Promise<ERC20PriceOracleInstance> {
  const erc20PriceOracle = await artifacts.require("ERC20PriceOracle").new(governance.address);

  const DummyERC20 = artifacts.require("DummyERC20");

  const dummyCoin1 = await DummyERC20.new("DummyCoin1", "DC1");
  const dummyCoin2 = await DummyERC20.new("DummyCoin2", "DC2");
  await dummyCoin1.mint(governance.address, REWARD_VALUE);
  await dummyCoin2.mint(governance.address, REWARD_VALUE);

  await erc20PriceOracle.setPriceOracle(priceOracle.address);
  await erc20PriceOracle.setERC20Settings(dummyCoin1.address, "0x" + unprefixedSymbolBytes(symbols[0]));
  await erc20PriceOracle.setERC20Settings(dummyCoin2.address, "0x" + unprefixedSymbolBytes(symbols[1]));

  return erc20PriceOracle;
}

async function deployVotingManager(artifacts: Artifacts, governance: Account): Promise<VotingManagerInstance> {
  const votingManager = await artifacts.require("VotingManager").new(governance.address);
  const currentPriceEpoch = await votingManager.getCurrentPriceEpochId();
  await votingManager.configureRewardEpoch(currentPriceEpoch, REWARD_EPOCH_DURATION_PRICE_EPOCHS);
  await votingManager.configureSigningDuration(180);
  return votingManager;
}

function outputAddresses(deployed: DeployedContracts) {
  const contractAddresses = Object.fromEntries(
    Object.entries(deployed).map(([name, contract]) => [name, contract.address])
  );
  writeFileSync(OUTPUT_FILE, JSON.stringify(contractAddresses, null, 2));
  console.log("Contract addresses stored in " + OUTPUT_FILE);
}
