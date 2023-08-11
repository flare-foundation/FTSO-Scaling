import { readFileSync } from "fs";
import glob from "glob";
import Web3 from "web3";
import utils from "web3-utils";
import { Account } from "web3-core";

export async function getWeb3Contract(web3: Web3, address: string, name: string) {
  let abiPath = await relativeContractABIPathForContractName(name);
  return new web3.eth.Contract(getAbi(`artifacts/${abiPath}`), address);
}

export function getWeb3Wallet(web3: Web3, privateKey: string): Account {
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

/**
 * Hashes a message.
 * @param message
 * @returns
 */
export function hashMessage(message: string): string {
  if (!message.startsWith("0x")) {
    throw new Error("Message must be hex string prefixed with 0x");
  }
  return utils.soliditySha3(message)!;
}
