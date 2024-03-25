import { readFileSync } from "fs";
import { AbiEventFragment, AbiFunctionFragment, AbiInput } from "web3";
import { encodeEventSignature, encodeFunctionSignature } from "web3-eth-abi";
import { ContractDefinitionsNames, ContractMethodNames } from "../configs/contracts";
import {
  InflationRewardsOffered,
  RandomAcquisitionStarted,
  RewardEpochStarted,
  RewardsOffered,
  SigningPolicyInitialized,
  SigningPolicySigned,
  VotePowerBlockSelected,
  VoterRegistered,
  VoterRegistrationInfo,
} from "../events";

type AbiItem = AbiFunctionFragment | AbiEventFragment;

export interface AbiData {
  abi: AbiItem;
  signature: string;
  isEvent: boolean;
}

export interface AbiDataInput {
  abi: AbiInput;
  signature: string;
}

export class ABICache {
  // contractName => abi
  readonly contractNameToAbi = new Map<string, AbiItem[]>();
  // contractName|functionName => abi
  readonly contractAndNameToAbiData = new Map<string, AbiData>();

  constructor() {
    const cachedABIs: [ContractDefinitionsNames, ContractMethodNames | undefined, string | undefined][] = [
      ["Submission", ContractMethodNames.submit1, undefined],
      ["Submission", ContractMethodNames.submit2, undefined],
      ["Submission", ContractMethodNames.submit3, undefined],
      ["Submission", ContractMethodNames.submitSignatures, undefined],
      ["FlareSystemsManager", undefined, VotePowerBlockSelected.eventName],
      ["FlareSystemsManager", undefined, RandomAcquisitionStarted.eventName],
      ["FlareSystemsManager", undefined, RewardEpochStarted.eventName],
      ["VoterRegistry", undefined, VoterRegistered.eventName],
      ["FlareSystemsCalculator", undefined, VoterRegistrationInfo.eventName],
      ["Relay", undefined, SigningPolicyInitialized.eventName],
      ["Relay", ContractMethodNames.relay, undefined],
      ["FlareSystemsManager", undefined, SigningPolicySigned.eventName],
      ["FtsoRewardOffersManager", undefined, InflationRewardsOffered.eventName],
      ["FtsoRewardOffersManager", undefined, RewardsOffered.eventName],
      ["FtsoMerkleStructs", ContractMethodNames.feedStruct, undefined],
      ["FtsoMerkleStructs", ContractMethodNames.randomStruct, undefined],
      ["FtsoMerkleStructs", ContractMethodNames.feedWithProofStruct, undefined],
      ["ProtocolMerkleStructs", ContractMethodNames.rewardClaimStruct, undefined],
      ["ProtocolMerkleStructs", ContractMethodNames.rewardClaimWithProofStruct, undefined],
    ];

    for (const [contractName, functionName, eventName] of cachedABIs) {
      // Preload the ABIs. If something wrong, it throws exception
      this.getAbi(contractName, functionName, eventName);
    }
  }

  /**
   * Returns relevant ABI definitions given a smart contract name and function/event name.
   * For internal use only.
   */
  getAbi(smartContractName: string, functionName?: string, eventName?: string): AbiData {
    if ((!functionName && !eventName) || (functionName && eventName)) {
      throw new Error("Must specify either functionName or eventName");
    }
    const key = this.keyForAbiData(smartContractName, functionName, eventName);
    let abiData = this.contractAndNameToAbiData.get(key);
    if (abiData) return abiData;
    let contractAbi = this.contractNameToAbi.get(smartContractName);
    if (!contractAbi) {
      try {
        contractAbi = JSON.parse(readFileSync(`abi/${smartContractName}.json`).toString()).abi as AbiItem[];
      } catch (e) {
        throw new Error(`Could not load ABI for ${smartContractName}`);
      }
      this.contractNameToAbi.set(smartContractName, contractAbi);
    }

    const searchName = functionName ? functionName : eventName!;
    const item = contractAbi.find((x: AbiItem) => x.name === searchName)!;
    if (!item) {
      throw new Error(
        `Could not find ABI for '${smartContractName}' ${functionName ? "function" : "event"} '${searchName}'`
      );
    }
    abiData = {
      abi: item,
      isEvent: !!eventName,
      signature: functionName ? encodeFunctionSignature(item) : encodeEventSignature(item),
    };
    this.contractAndNameToAbiData.set(key, abiData);
    return abiData;
  }

  getAbiInput(smartContractName: string, functionName: string, functionArgumentId: number): AbiDataInput {
    const abiData = this.getAbi(smartContractName, functionName);
    const abiDataInput: AbiDataInput = {
      abi: abiData.abi.inputs[functionArgumentId],
      signature: abiData.signature,
    };
    return abiDataInput;
  }

  /**
   * Returns key for cache dictionary for ABI data
   * Keys are of the form "contractName|functionName" or "contractName|eventName"
   */
  private keyForAbiData(smartContractName: string, functionName?: string, eventName?: string): string {
    return `${smartContractName}|${functionName ? functionName : eventName!}`;
  }
}
