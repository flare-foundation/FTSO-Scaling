import { readFileSync } from "fs";
import { sleepFor } from "../../src/time-utils";
import { Feed, Offer } from "../../src/voting-interfaces";
import { Account } from "web3-core";

import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ZERO_ADDRESS, toBytes4, hexlifyBN } from "../../src/voting-utils";
import { VotingRewardManagerInstance } from "../../typechain-truffle";
import { toBN } from "web3-utils";
import { OUTPUT_FILE, loadAccounts } from "./common";
import { FTSOParameters } from "../config/FTSOParameters";

const REWARD_VALUE = 1000999;
const IQR_SHARE = 700000;
const PCT_SHARE = 300000;
const ELASTIC_BAND_WIDTH_PPM = 50000;
const DEFAULT_REWARD_BELT_PPM = 500000; // 50%

function loadContracts() {
  return JSON.parse(readFileSync(OUTPUT_FILE).toString());
}

async function offerRewards(
  rewardEpochId: number,
  symbols: Feed[],
  votingRewardManager: VotingRewardManagerInstance,
  governance: string,
  leadProviders: string[],
  rewardValue: BN
) {
  console.log(`Offering rewards for epoch ${rewardEpochId}...`);

  const toBN = web3.utils.toBN;

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
      rewardBeltPPM: toBN(DEFAULT_REWARD_BELT_PPM),
      flrValue: amount,
      elasticBandWidthPPM: toBN(ELASTIC_BAND_WIDTH_PPM),
      iqrSharePPM: toBN(IQR_SHARE),
      pctSharePPM: toBN(PCT_SHARE),
      remainderClaimer: ZERO_ADDRESS,
    } as Offer;
    totalAmount = totalAmount.add(amount);
    offersSent.push(basicOffer);
  }

  let receipt = await votingRewardManager.offerRewards(hexlifyBN(offersSent), { from: governance, value: totalAmount });
  console.log(`"Reward offers sent, gas used: ${receipt.receipt.gasUsed}`);
}

/**
 * Runs admin tasks like providing offers
 */
export async function runAdminDaemon(hre: HardhatRuntimeEnvironment, parameters: FTSOParameters) {
  const accounts = loadAccounts();
  const governance: Account = accounts[0];

  const contractAddresses = loadContracts();

  const votingRewardManager = await hre.artifacts
    .require("VotingRewardManager")
    .at(contractAddresses.votingRewardManager);

  const votingManager = await hre.artifacts.require("VotingManager").at(contractAddresses.votingManager);
  let lastEpoch = -1;

  while (true) {
    await tick(hre, governance);

    const currentRewardEpoch: number = (await votingManager.getCurrentRewardEpochId()).toNumber();
    const currentPriceEpoch: number = (await votingManager.getCurrentPriceEpochId()).toNumber();
    console.log(`Current reward epoch: ${currentRewardEpoch}, current price epoch: ${currentPriceEpoch}`);

    if (currentRewardEpoch > lastEpoch) {
      await offerRewards(
        currentRewardEpoch + 1, // Offering for next epoch
        parameters.symbols,
        votingRewardManager,
        governance.address,
        [accounts[1].address],
        toBN(REWARD_VALUE)
      );
      lastEpoch = currentRewardEpoch;
    }

    await sleepFor(1_000);
  }
}
/**
 * Generates a dummy transaction so that new blocks get mined.
 */
async function tick(hre: HardhatRuntimeEnvironment, governance: Account) {
  await hre.web3.eth.sendTransaction({ value: 100, from: governance.address, to: governance.address });
}
