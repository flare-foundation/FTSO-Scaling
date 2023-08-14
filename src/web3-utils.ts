import { readFileSync } from "fs";
import glob from "glob";
import Web3 from "web3";
import { Account } from "web3-core";
import utils from "web3-utils";
import { AbiItem } from "web3-utils/types";

export async function loadContract<ContractType>(web3: Web3, address: string, name: string) {
  if (!address) throw Error(`Address for ${name} not provided`);
  const abiPath = await relativeContractABIPathForContractName(name);
  const contract = new web3.eth.Contract(getAbi(`artifacts/${abiPath}`), address);
  return contract as ContractType;
}

export function getAccount(web3: Web3, privateKey: string): Account {
  if (privateKey.indexOf("0x") != 0) {
    privateKey = "0x" + privateKey;
  }
  return web3.eth.accounts.privateKeyToAccount(privateKey);
}

export function getAbi(abiPath: string) {
  let abi = JSON.parse(readFileSync(abiPath).toString());
  if (abi.abi) {
    abi = abi.abi;
  }
  return abi;
}

export async function relativeContractABIPathForContractName(
  name: string,
  artifactsRoot = "artifacts"
): Promise<string> {
  return new Promise((resolve, reject) => {
    glob(`contracts/**/${name}.sol/${name}.json`, { cwd: artifactsRoot }, (er: any, files: string[] | null) => {
      if (er) {
        reject(er);
      } else {
        if (files && files.length === 1) {
          resolve(files[0]);
        } else {
          reject(files);
        }
      }
    });
  });
}

export function hashMessage(message: string): string {
  if (!message.startsWith("0x")) {
    throw new Error("Message must be hex string prefixed with 0x");
  }
  return utils.soliditySha3(message)!;
}

export function getContractAbis(web3: Web3) {
  const votingAbiPath = "artifacts/contracts/voting/implementation/Voting.sol/Voting.json";
  const rewardsAbiPath = "artifacts/contracts/voting/implementation/VotingRewardManager.sol/VotingRewardManager.json";
  const votingABI = JSON.parse(readFileSync(votingAbiPath).toString()).abi as AbiItem[];
  const rewardsABI = JSON.parse(readFileSync(rewardsAbiPath).toString()).abi as AbiItem[];

  const functionSignatures: Map<string, string> = new Map<string, string>();
  const eventSignatures: Map<string, string> = new Map<string, string>();
  const abis: Map<string, any> = new Map<string, string>();

  abis.set(
    "commit",
    votingABI.find((x: any) => x.name === "commit")
  );
  abis.set(
    "revealBitvote",
    votingABI.find((x: any) => x.name === "revealBitvote")
  );
  abis.set(
    "signResult",
    votingABI.find((x: any) => x.name === "signResult")
  );
  abis.set(
    "offerRewards",
    rewardsABI.find((x: any) => x.name === "offerRewards")
  );
  abis.set(
    "claimRewardBodyDefinition",
    rewardsABI.find((x: any) => x.name === "claimRewardBodyDefinition")?.inputs?.[0]
  );
  abis.set(
    "RewardOffered",
    rewardsABI.find((x: any) => x.name === "RewardOffered")
  );
  functionSignatures.set("commit", web3.eth.abi.encodeFunctionSignature(abis.get("commit")));
  functionSignatures.set("revealBitvote", web3.eth.abi.encodeFunctionSignature(abis.get("revealBitvote")));
  functionSignatures.set("signResult", web3.eth.abi.encodeFunctionSignature(abis.get("signResult")));
  functionSignatures.set("offerRewards", web3.eth.abi.encodeFunctionSignature(abis.get("offerRewards")));

  eventSignatures.set("RewardOffered", web3.eth.abi.encodeEventSignature(abis.get("RewardOffered")));

  return [functionSignatures, eventSignatures, abis];
}
