import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { base58 } from '@scure/base';
import path from "path/posix";
import { DataProviderConditions, DataProviderPasses, ListedProviderList, ValidatorInfo } from "./minimal-conditions-interfaces";
import { bigIntReplacer } from "../../../../ftso-core/src/utils/big-number-serialization";
import {CALCULATIONS_FOLDER, PASSES_DATA_FOLDER, STAKING_DATA_FOLDER} from "../../constants";

/**
 * Reads the staking info for a given reward epoch id. 
 * The data is stored in the staking data folder. 
 */
export function readStakingInfo(
   rewardEpochId: number,
   stakingDataFolder = STAKING_DATA_FOLDER()
): ValidatorInfo[] {
   const fname = path.join(stakingDataFolder, `${rewardEpochId}-nodes-data.json`);
   const data = readFileSync(fname, 'utf8');
   const result: ValidatorInfo[] = JSON.parse(data);
   for(let validatorInfo of result) {
      // "NodeID-2a7BPY7UeJv2njMuyUHfBSTeQCYZj6bwV"
      // Checksum is not validated
      validatorInfo.nodeId20Byte = "0x" + Buffer.from(base58.decode(validatorInfo.nodeId.slice(7)).subarray(0, -4)).toString("hex");
   }
   return result;
}

/**
 * Reads the passes info for a given reward epoch id.
 * The data is stored in the passes data folder.
 */
export function readPassesInfo(
   rewardEpochId: number,
   passesDataFolder = PASSES_DATA_FOLDER()
): DataProviderPasses[] | undefined {
   const fname = path.join(passesDataFolder, `${rewardEpochId}-passes-data.json`);
   if(!existsSync(fname)) {
      return undefined;
   }
   const data = readFileSync(fname, 'utf8');
   return JSON.parse(data);
}

/**
 * Writes the staking info for a given reward epoch id.
 */
export function writePassesInfo(
   rewardEpochId: number,
   data: DataProviderPasses,
   passesDataFolder = PASSES_DATA_FOLDER()
): void {
   if (!existsSync(passesDataFolder)) {
      mkdirSync(passesDataFolder, { recursive: true });
   }
   const fname = path.join(passesDataFolder, `${rewardEpochId}-passes-data.json`);
   writeFileSync(fname, JSON.stringify(data));
}

/**
 * Writes the staking info for a given reward epoch id.
 */
export function writeDataProviderConditions(
   rewardEpochId: number,
   data: DataProviderConditions[],
   calculationFolder = CALCULATIONS_FOLDER()
): void {
   if (!existsSync(calculationFolder)) {
      mkdirSync(calculationFolder, { recursive: true });
   }
   const fname = path.join(calculationFolder, `${rewardEpochId}`, `minimal-conditions.json`);
   writeFileSync(fname, JSON.stringify(data, bigIntReplacer, 2));
}

export function readListedDataProviders(): ListedProviderList {
   const fname = path.join(`listed-data-providers`, `bifrost-wallet.providerlist.json`);
   const data = readFileSync(fname, 'utf8');
   return JSON.parse(data);
}
