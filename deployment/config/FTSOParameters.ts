import { readFileSync } from "fs";
import { Feed } from "../../src/protocol/voting-types";
import * as dotenv from "dotenv";
import { URL } from "url";
import BN from "bn.js";
import { toBN } from "../../src/protocol/utils/voting-utils";
dotenv.config();

export interface FTSOParameters {
  governancePrivateKey: string;
  rpcUrl: URL;
  gasLimit: BN;
  gasPriceMultiplier: number;
  symbols: Feed[];
}

function loadParameters(filename: string): FTSOParameters {
  const jsonText = readFileSync(filename).toString();
  const parameters = JSON.parse(jsonText, (key, value) => {
    if (key === "rpcUrl") return new URL(value);
    if (key === "gasLimit") return toBN(value);
    return value;
  });
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
