import { readFileSync } from "fs";
import { Feed } from "../../src/voting-interfaces";
import * as dotenv from "dotenv";
dotenv.config();

export interface FTSOParameters {
  governancePrivateKey: string;
  gasPrice: number;
  symbols: Feed[];
}

function loadParameters(filename: string): FTSOParameters {
  const jsonText = readFileSync(filename).toString();
  const parameters = JSON.parse(jsonText);
  return parameters;
}

export function loadFTSOParameters() {
  const chain = process.env.CHAIN_CONFIG;
  if (chain) {
    const parameters = loadParameters(`deployment/config/config-${chain}.json`);
    if (process.env.DEPLOYER_PRIVATE_KEY) {
      parameters.governancePrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
    }
    return parameters;
  } else {
    throw Error("Chain config must be set in env CHAIN_CONFIG");
  }
}
