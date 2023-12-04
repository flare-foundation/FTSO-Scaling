import { getWeb3 } from "../../src/utils/web3";
import { loadFTSOParameters } from "../../../apps/ftso-calculator/src/FTSOParameters";
import { sleepFor } from "../../src/utils/time";
import BN from "bn.js";

import { readFileSync } from "fs";
import { Web3Provider } from "../../src/providers/Web3Provider";
import { OUTPUT_FILE } from "../tasks/common";
import { ContractAddresses } from "../../src/protocol/utils/ContractAddresses";
import { getLogger } from "../../src/utils/logger";
import { ZERO_ADDRESS, toBN, toBytes4 } from "../../src/protocol/utils/voting-utils";
import _ from "lodash";
import { Feed, Offer } from "../../src/protocol/voting-types";
import { errorString } from "../../src/protocol/utils/error";

const REWARD_VALUE = 10_000;
const IQR_SHARE = 700_000;
const PCT_SHARE = 300_000;
const ELASTIC_BAND_WIDTH_PPM = 50_000;
const DEFAULT_REWARD_BELT_PPM = 500_000; // 50%

const logger = getLogger("reward-sender");

async function main() {
  const parameters = loadFTSOParameters();
  const web3 = getWeb3(parameters.rpcUrl.toString());

  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!deployerKey) throw Error("No deployer private key found in env.");
  web3.eth.accounts.wallet.add(deployerKey);
  const deployerAddress = web3.eth.accounts.privateKeyToAccount(deployerKey!).address;
  logger.info(
    `Connected to ${parameters.rpcUrl}, deployer ${deployerAddress}, balance: ${+(await web3.eth.getBalance(
      deployerAddress
    ))}`
  );

  const contractAddresses = loadContracts();
  const provider = await Web3Provider.create(contractAddresses, web3, parameters, deployerKey);

  const timeout = (provider.epochDurationSec * 1000) / 3; // Run 3 times per price epoch
  let lastEpoch = -1;

  while (true) {
    try {
      const currentRewardEpoch: number = await provider.getCurrentRewardEpochId();
      if (currentRewardEpoch > lastEpoch) {
        await offerRewards(
          currentRewardEpoch + 1, // Offering for next epoch
          parameters.feeds.map(x => x.symbol),
          provider,
          deployerAddress,
          [],
          toBN(REWARD_VALUE)
        );
        lastEpoch = currentRewardEpoch;
      }
    } catch (e) {
      logger.error(`Failed to send offers: ${errorString(e)}`);
    }

    await sleepFor(timeout);
  }
}

function loadContracts(): ContractAddresses {
  const parsed = JSON.parse(readFileSync(OUTPUT_FILE).toString());
  if (Object.entries(parsed).length == 0) throw Error(`No contract addresses found in ${OUTPUT_FILE}`);
  return parsed;
}

async function offerRewards(
  rewardEpochId: number,
  symbols: Feed[],
  provider: Web3Provider,
  backClaimer: string,
  leadProviders: string[],
  rewardValue: BN
) {
  logger.info(`Offering rewards for next reward epoch ${rewardEpochId}.`);
  let totalAmount = toBN(0);
  const offersSent: Offer[] = [];
  for (let i = 0; i < symbols.length; i++) {
    const amount = rewardValue.add(toBN(i));
    const basicOffer: Offer = {
      amount: amount,
      currencyAddress: ZERO_ADDRESS,
      offerSymbol: toBytes4(symbols[i].offerSymbol),
      quoteSymbol: toBytes4(symbols[i].quoteSymbol),
      leadProviders: leadProviders,
      rewardBeltPPM: toBN(DEFAULT_REWARD_BELT_PPM),
      elasticBandWidthPPM: toBN(ELASTIC_BAND_WIDTH_PPM),
      iqrSharePPM: toBN(IQR_SHARE),
      pctSharePPM: toBN(PCT_SHARE),
      remainderClaimer: backClaimer,
    };

    totalAmount = totalAmount.add(amount);
    offersSent.push(basicOffer);
  }
  await provider.offerRewards(offersSent);

  logger.info(`Offerred rewards for next reward epoch ${rewardEpochId}, total value ${totalAmount.toString()}`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
