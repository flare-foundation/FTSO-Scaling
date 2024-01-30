import { readFileSync } from "fs";
import { CONTRACTS, ContractMethodNames } from "../configs/networks";
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
import { AbiEventFragment, AbiFunctionFragment, AbiInput } from "web3";
import { encodeFunctionSignature, encodeEventSignature } from "web3-eth-abi";

type AbiItem = AbiFunctionFragment | AbiEventFragment;

export enum AbiType {
  Function,
  Event,
  Struct,
}
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
    // Cache the following ABIs
    // TODO: LUKA extract first parameter from ContractDefinitions union type
    const cachedABIs: [string, ContractMethodNames | undefined, string | undefined][] = [
      [CONTRACTS.Submission.name, ContractMethodNames.submit1, undefined],
      [CONTRACTS.Submission.name, ContractMethodNames.submit2, undefined],
      [CONTRACTS.Submission.name, ContractMethodNames.submit3, undefined],
      [CONTRACTS.Submission.name, ContractMethodNames.submitSignatures, undefined],
      [CONTRACTS.FlareSystemManager.name, undefined, VotePowerBlockSelected.eventName],
      [CONTRACTS.FlareSystemManager.name, undefined, RandomAcquisitionStarted.eventName],
      [CONTRACTS.FlareSystemManager.name, undefined, RewardEpochStarted.eventName],
      [CONTRACTS.VoterRegistry.name, undefined, VoterRegistered.eventName],
      [CONTRACTS.FlareSystemCalculator.name, undefined, VoterRegistrationInfo.eventName],
      [CONTRACTS.Relay.name, undefined, SigningPolicyInitialized.eventName],
      [CONTRACTS.Relay.name, ContractMethodNames.relay, undefined],
      [CONTRACTS.FlareSystemManager.name, undefined, SigningPolicySigned.eventName],
      [CONTRACTS.FtsoRewardOffersManager.name, undefined, InflationRewardsOffered.eventName],
      [CONTRACTS.FtsoRewardOffersManager.name, undefined, RewardsOffered.eventName],
      [CONTRACTS.FtsoMerkleStructs.name, ContractMethodNames.feedStruct, undefined],
      [CONTRACTS.FtsoMerkleStructs.name, ContractMethodNames.randomStruct, undefined],
      [CONTRACTS.FtsoMerkleStructs.name, ContractMethodNames.feedWithProofStruct, undefined],
      [CONTRACTS.ProtocolMerkleStructs.name, ContractMethodNames.rewardClaimStruct, undefined],
      [CONTRACTS.ProtocolMerkleStructs.name, ContractMethodNames.rewardClaimWithProofStruct, undefined],
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
