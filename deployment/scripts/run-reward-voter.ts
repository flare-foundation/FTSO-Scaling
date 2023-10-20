import { readFileSync } from "fs";
import { Web3Provider } from "../../src/providers/Web3Provider";
import { loadFTSOParameters } from "../config/FTSOParameters";
import { ContractAddresses, OUTPUT_FILE, loadAccounts } from "../tasks/common";
import { getLogger, setGlobalLogFile } from "../../src/utils/logger";
import { getWeb3 } from "../../src/utils/web3";
import { RewardVoter } from "../../src/RewardVoter";

async function main() {
  const voterId = +process.argv[2]; // Should match the id of a running price voter.
  const myId = +process.argv[3];
  if (!myId) throw Error("Must provide an id.");
  if (myId <= 0) throw Error("Id must be greater than 0.");

  setGlobalLogFile(`reward-manager-${myId}`);

  const parameters = loadFTSOParameters();
  const web3 = getWeb3(parameters.rpcUrl.toString());

  const contractAddresses = loadContracts();
  getLogger("reward-manager").info(
    `Initializing reward-manager ${myId}, for voter ${voterId} connecting to ${parameters.rpcUrl}`
  );

  let privateKey: string;
  let voterKey: string;
  if (process.env.REWARD_MANAGER_KEY != undefined && process.env.VOTER_KEY != undefined) {
    privateKey = process.env.REWARD_MANAGER_KEY;
    voterKey = process.env.VOTER_KEY;
  } else {
    const accounts = loadAccounts(web3);
    privateKey = accounts[myId].privateKey;
    voterKey = accounts[voterId].privateKey;
  }

  const provider = await Web3Provider.create(contractAddresses, web3, parameters, privateKey);
  const rewardVoter = new RewardVoter(provider, voterKey, web3);
  await rewardVoter.run();
}

function loadContracts(): ContractAddresses {
  const parsed = JSON.parse(readFileSync(OUTPUT_FILE).toString());
  if (Object.entries(parsed).length == 0) throw Error(`No contract addresses found in ${OUTPUT_FILE}`);
  return parsed;
}

main().catch(e => {
  console.error("Reward voter error, exiting", e);
  getLogger("reward-manager").error(e);
  process.exit(1);
});
