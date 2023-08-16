import { readFileSync } from "fs";
import glob from "glob";
import Web3 from "web3";
import { Account } from "web3-core";

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