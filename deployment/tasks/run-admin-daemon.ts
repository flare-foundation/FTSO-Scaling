import { readFileSync } from "fs";
import { sleepFor } from "../../src/utils/time";
import { Feed, Offer } from "../../src/protocol/voting-types";
import { Account } from "web3-core";

import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ZERO_ADDRESS, toBytes4, hexlifyBN } from "../../src/protocol/utils/voting-utils";
import { VotingManagerInstance, VotingRewardManagerInstance } from "../../typechain-truffle";
import { toBN } from "web3-utils";
import { OUTPUT_FILE } from "./common";
import { FTSOParameters } from "../config/FTSOParameters";
import { getLogger } from "../../src/utils/logger";
import { isHardhatNetwork } from "../../test-utils/utils/test-helpers";

const REWARD_VALUE = 1000999;
const IQR_SHARE = 700000;
const PCT_SHARE = 300000;
const ELASTIC_BAND_WIDTH_PPM = 50000;
const DEFAULT_REWARD_BELT_PPM = 500000; // 50%

const logger = getLogger("admin-daemon");

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
  logger.info(`Offering rewards for next reward epoch ${rewardEpochId}.`);

  let totalAmount = toBN(0);
  const offersSent: Offer[] = [];
  for (let i = 0; i < symbols.length; i++) {
    const amount = rewardValue.add(toBN(i));
    const basicOffer = {
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
    logger.info(`Offering ${amount} for ${symbols[i].offerSymbol}/${symbols[i].quoteSymbol}`);
    totalAmount = totalAmount.add(amount);
    offersSent.push(basicOffer);
  }
  const receipt = await votingRewardManager.offerRewards(hexlifyBN(offersSent), {
    from: governance,
    value: totalAmount,
  });
  logger.info(`Offers sent for reward epoch ${rewardEpochId}, gas used: ${receipt.receipt.gasUsed}`);
}

/**
 * Generates offers for every reward epoch, and sends periodic transactions
 * to make sure new blocks are mined on the Hardhat network.
 */
export async function runAdminDaemon(hre: HardhatRuntimeEnvironment, parameters: FTSOParameters) {
  const governance: Account = hre.web3.eth.accounts.privateKeyToAccount(parameters.governancePrivateKey);

  const contractAddresses = loadContracts();

  const votingRewardManager: VotingRewardManagerInstance = await hre.artifacts
    .require("VotingRewardManager")
    .at(contractAddresses.votingRewardManager);
  const votingManager: VotingManagerInstance = await hre.artifacts
    .require("VotingManager")
    .at(contractAddresses.votingManager);

  const timeout = ((await votingManager.BUFFER_WINDOW()).toNumber() * 1000) / 3; // Run 3 times per price epoch
  let lastEpoch = -1;

  while (true) {
    try {
      await tick(hre, governance);
      const currentRewardEpoch: number = (await votingManager.getCurrentRewardEpochId()).toNumber();
      if (currentRewardEpoch > lastEpoch) {
        await offerRewards(
          currentRewardEpoch + 1, // Offering for next epoch
          parameters.symbols,
          votingRewardManager,
          governance.address,
          [],
          toBN(REWARD_VALUE)
        );
        lastEpoch = currentRewardEpoch;
      }
    } catch (e) {
      logger.error(e);
    }

    await sleepFor(timeout);
  }
}
/**
 * Generates a dummy transaction to make sure new blocks get mined.
 * Only applicable for local networks.
 */
async function tick(hre: HardhatRuntimeEnvironment, governance: Account) {
  if (isHardhatNetwork(hre)) {
    await hre.web3.eth.sendTransaction({ value: 100, from: governance.address, to: governance.address });
  }
}
