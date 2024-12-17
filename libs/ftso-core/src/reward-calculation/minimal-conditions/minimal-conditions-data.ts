import { base58 } from '@scure/base';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path/posix";
import { CALCULATIONS_FOLDER, PASSES_DATA_FOLDER, STAKING_DATA_FOLDER } from "../../configs/networks";
import { bigIntReplacer, bigIntReviver } from "../../utils/big-number-serialization";
import { DataProviderConditions, DataProviderPasses, ListedProviderList, ValidatorInfo } from "./minimal-conditions-interfaces";
import { MINIMAL_CONDITIONS_FILE, PASSES_FILE } from '../../utils/stat-info/constants';

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
   const result: ValidatorInfo[] = JSON.parse(data, bigIntReviver);
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
   calculationFolder = CALCULATIONS_FOLDER()
): DataProviderPasses[] {
   const fname = path.join(calculationFolder, `${rewardEpochId}`, PASSES_FILE);
   if(!existsSync(fname)) {
      throw new Error(`Passes file not found: ${fname}`);
   }
   const data = readFileSync(fname, 'utf8');
   return JSON.parse(data) as DataProviderPasses[];
}

/**
 * Writes the staking info for a given reward epoch id.
 */
export function writePassesInfo(
   rewardEpochId: number,
   data: DataProviderPasses[],
   calculationFolder = CALCULATIONS_FOLDER()
): void {   
   if (!existsSync(calculationFolder)) {
      mkdirSync(calculationFolder, { recursive: true });
   }
   const fname = path.join(calculationFolder, `${rewardEpochId}`, PASSES_FILE);
   writeFileSync(fname, JSON.stringify(data, null, 2));
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
   const fname = path.join(calculationFolder, `${rewardEpochId}`, MINIMAL_CONDITIONS_FILE);
   writeFileSync(fname, JSON.stringify(data, bigIntReplacer, 2));
}

export function readListedDataProviders(): ListedProviderList {
   const fname = path.join(`listed-data-providers`, `bifrost-wallet.providerlist.json`);
   const data = readFileSync(fname, 'utf8');
   return JSON.parse(data);
}
