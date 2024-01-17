import { readFileSync } from "fs";
import Web3 from "web3";
import { AbiItem } from "web3-utils/types";
import { CONTRACTS } from "../configs/networks";
import { TLPEvents, TLPTransaction } from "../orm/entities";
import { IPayloadMessage, PayloadMessage } from "./PayloadMessage";
import { InflationRewardsOffered, RandomAcquisitionStarted, RewardEpochStarted, RewardsOffered, VotePowerBlockSelected, VoterRegistered, VoterRegistrationInfo } from "../events";
import { SigningPolicyInitialized } from "../events/SigningPolicyInitialized";


export interface AbiData {
  abi: AbiItem;
  signature: string;
  isEvent: boolean;
}

// contractName => abi
const contractNameToAbi = new Map<string, AbiItem[]>();
// contractName|functionName => abi
const contractAndNameToAbiData = new Map<string, AbiData>();

const coder = new Web3().eth.abi;

/**
 * Returns key for cache dictionary for ABI data
 * Keys are of the form "contractName|functionName" or "contractName|eventName"
 * @param smartContractName 
 * @param functionName 
 * @param eventName 
 * @returns 
 */
function keyForAbiData(smartContractName: string, functionName?: string, eventName?: string): string {
  return `${smartContractName}|${functionName ? functionName : eventName!}`;
}

/**
 * Returns relevant ABI definitions given a smart contract name and function/event name.
 * For internal use only.
 * @param smartContractName 
 * @param functionName 
 * @param eventName 
 * @returns 
 */
function getAbi(smartContractName: string, functionName?: string, eventName?: string): AbiData {
  if ((!functionName && !eventName) || (functionName && eventName)) {
    throw new Error("Must specify either functionName or eventName");
  }
  let key = keyForAbiData(smartContractName, functionName, eventName);
  let abiData = contractAndNameToAbiData.get(key);
  if (abiData) return abiData;
  let contractAbi = contractNameToAbi.get(smartContractName);
  if (!contractAbi) {
    try {
      contractAbi = JSON.parse(readFileSync(`abi/${smartContractName}.json`).toString()).abi as AbiItem[];
    } catch (e) {
      throw new Error(`Could not load ABI for ${smartContractName}`);
    }
    contractNameToAbi.set(smartContractName, contractAbi);
  }

  const searchName = functionName ? functionName : eventName!;
  let item = contractAbi.find((x: AbiItem) => x.name === searchName)!;
  if (!item) {
    throw new Error(`Could not find ABI for '${smartContractName}' ${functionName ? "function" : "event"} '${searchName}'`);
  }
  abiData = {
    abi: item,
    isEvent: !!eventName,
    signature: functionName ? this.coder.encodeFunctionSignature(item) : this.coder.encodeEventSignature(item),
  } as AbiData;
  contractAndNameToAbiData.set(key, abiData);
  return abiData;
}

/**
 * Returns ABI definition for a given smart contract name and function name
 * @param contractName 
 * @param functionName 
 * @returns 
 */
export function getFunctionAbiData(contractName: string, functionName: string): AbiData {
  return getAbi(contractName, functionName);
}

/**
 * Returns ABI definition for a given smart contract name and event name
 * @param contractName 
 * @param eventName 
 * @returns 
 */
export function getEventAbiData(contractName: string, eventName: string): AbiData {
  return getAbi(contractName, undefined, eventName);
}

// Cache the following ABIs
const cachedABIs: [string, string | undefined, string | undefined][] = [
  [CONTRACTS.Submission.name, "submit1", undefined],
  [CONTRACTS.Submission.name, "submit2", undefined],
  [CONTRACTS.Submission.name, "submit3", undefined],
  [CONTRACTS.Submission.name, "submitSignatures", undefined],
  [CONTRACTS.FlareSystemManager.name, undefined, VotePowerBlockSelected.eventName],
  [CONTRACTS.FlareSystemManager.name, undefined, RandomAcquisitionStarted.eventName], //  "RandomAcquisitionStarted"],
  [CONTRACTS.FlareSystemManager.name, undefined, RewardEpochStarted.eventName],  
  [CONTRACTS.VoterRegistry.name, undefined, VoterRegistered.eventName],
  [CONTRACTS.FlareSystemCalculator.name, undefined, VoterRegistrationInfo.eventName],
  [CONTRACTS.Relay.name, undefined, SigningPolicyInitialized.eventName],
  [CONTRACTS.FlareSystemManager.name, undefined, "SigningPolicySigned"],
  [CONTRACTS.FtsoRewardOffersManager.name, undefined, InflationRewardsOffered.eventName],
  [CONTRACTS.FtsoRewardOffersManager.name, undefined, RewardsOffered.eventName],
]



for (const [contractName, functionName, eventName] of cachedABIs) {
  // Preload the ABIs. If something wrong, it throws exception
  const abiData = getAbi(contractName, functionName, eventName);
}

/**
 * Returns function signature for a given smart contract name and function name
 * @param smartContractName 
 * @param functionName 
 * @returns 
 */
export function getFunctionSignature(smartContractName: string, functionName: string): string {
  return getFunctionAbiData(smartContractName, functionName).signature;
}

/**
 * Returns event signature for a given smart contract name and event name
 * @param smartContractName 
 * @param eventName 
 * @returns 
 */
export function getEventSignature(smartContractName: string, eventName: string): string {
  return getEventAbiData(smartContractName, eventName).signature;
}

/**
 * Decodes and transforms event @param data obtained from the indexer database,
 * for a given @param smartContractName and @param eventName into target 
 * transformation type T, using @param transform function.
 * @param smartContractName 
 * @param eventName 
 * @param data 
 * @param transform 
 * @returns 
 */
export function decodeEvent<T>(smartContractName: string, eventName: string, data: TLPEvents, transform: (data: any) => T): T {
  const abiData = getEventAbiData(smartContractName, eventName);
  function prefix0x(x: string) {
    return x.startsWith("0x") ? x : "0x" + x;
  }
  return transform(coder.decodeLog(
    abiData.abi!.inputs!,
    prefix0x(data.data),
    // Assumption: we will use it only with Solidity generated non-anonymous events from trusted contracts
    [data.topic0, data.topic1, data.topic2, data.topic3].filter(x => x).map(x => prefix0x(x))
  ));
}

/**
 * Decode function call data encoded using PayloadMessage
 * @param smartContractName 
 * @param functionName 
 * @param data 
 * @param transform 
 */
export function decodePayloadMessageCalldata(tx: TLPTransaction): IPayloadMessage<string>[] {
  // input in database is hex string, without 0x, first 4 bytes are function signature
  const payloadData = tx.input!.slice(8); // dropping function signature
  return PayloadMessage.decode(payloadData);
}

// export default class EncodingUtils {
//   private functionSignatures = new Map<string, string>();
//   private eventSignatures = new Map<string, string>();
//   private abiItems = new Map<string, AbiItem>();
//   private abiInputs = new Map<string, AbiInput>();

//   private coder = new Web3().eth.abi;

//   private constructor() {
//     const systemManagerAbi = JSON.parse(readFileSync(systemManagerAbiPath).toString()).abi as AbiItem[];
//     const relayAbi = JSON.parse(readFileSync(relayAbiPath).toString()).abi as AbiItem[];
//     const submissionAbi = JSON.parse(readFileSync(submissionAbiPath).toString()).abi as AbiItem[];
//     const voterRegistryAbi = JSON.parse(readFileSync(voterRegistryAbiPath).toString()).abi as AbiItem[];

//     this.abiItems.set(commitFunction, submissionAbi.find((x: AbiItem) => x.name === commitFunction)!);
//     this.abiItems.set(revealFunction, submissionAbi.find(x => x.name === revealFunction)!);
//     this.abiItems.set(signFunction, submissionAbi.find(x => x.name === signFunction)!);

//     // this.abiItems.set("finalize", votingABI.find(x => x.name === "finalize")!);
//     this.abiItems.set("SigningPolicyInitialized", relayAbi.find(x => x.name === "SigningPolicyInitialized")!);
//     this.abiItems.set("VoterRegistered", voterRegistryAbi.find(x => x.name === "VoterRegistered")!);
//     // this.abiItems.set("offerRewards", rewardsABI.find(x => x.name === "offerRewards")!);
//     // this.abiItems.set("RewardOffered", rewardsABI.find(x => x.name === "RewardOffered")!);
//     // this.abiInputs.set("rewardClaimDefinition", rewardsABI.find(x => x.name === "rewardClaimDefinition")!.inputs![0]);

//     // this.functionSignatures.set(commitFunction, this.coder.encodeFunctionSignature(this.abiItems.get(commitFunction)!));
//     // this.functionSignatures.set(revealFunction, this.coder.encodeFunctionSignature(this.abiItems.get(revealFunction)!));
//     // this.functionSignatures.set(signFunction, this.coder.encodeFunctionSignature(this.abiItems.get(signFunction)!));
//     // this.functionSignatures.set("offerRewards", this.coder.encodeFunctionSignature(this.abiItems.get("offerRewards")!));

//     // this.eventSignatures.set("RewardOffered", this.coder.encodeEventSignature(this.abiItems.get("RewardOffered")!));

//     this.eventSignatures.set(
//       "SigningPolicyInitialized",
//       this.coder.encodeEventSignature(this.abiItems.get("SigningPolicyInitialized")!)
//     );
//     this.eventSignatures.set("VoterRegistered", this.coder.encodeEventSignature(this.abiItems.get("VoterRegistered")!));
//   }

//   // functionSignature(name: string): string {
//   //   return this.functionSignatures.get(name)!;
//   // }

//   eventSignature(name: string): string {
//     return this.eventSignatures.get(name)!;
//   }

//   // abiItemForName(name: string) {
//   //   return this.abiItems.get(name)!;
//   // }

//   abiInputForName(name: string) {
//     return this.abiInputs.get(name)!;
//   }

//   extractSigningPolicies(events: TLPEvents[]): ISigningPolicy[] {
//     const result = events
//       .filter((x: TLPEvents) => x.topic0 === this.eventSignature("SigningPolicyInitialized").slice(2))
//       .map(event => {
//         const rawPolicy = this.coder.decodeLog(
//           this.abiItems.get("SigningPolicyInitialized")!.inputs!,
//           event.data,
//           [event.topic0, event.topic1, event.topic2, event.topic3].filter(x => x !== "")
//         );
//         const tmp = rawPolicy as any;
//         const policy: ISigningPolicy = {
//           rewardEpochId: parseIntOrThrow(tmp.rewardEpochId, 10),
//           startVotingRoundId: parseIntOrThrow(tmp.startVotingRoundId, 10),
//           threshold: Number(tmp.threshold),
//           seed: BigInt(tmp.seed),
//           voters: tmp.voters,
//           weights: tmp.weights.map((x: any) => Number(x)),
//         };
//         return policy;
//       });
//     return result;
//   }

//   extractVoterRegistration(events: TLPEvents[]): VoterRegistered[] {
//     const result = events
//       .filter((x: TLPEvents) => x.topic0 === this.eventSignature("VoterRegistered").slice(2))
//       .map(event => {
//         const raw = this.coder.decodeLog(
//           this.abiItems.get("VoterRegistered")!.inputs!,
//           event.data,
//           [event.topic0, event.topic1, event.topic2, event.topic3].filter(x => x !== "")
//         );
//         const tmp = raw as any;
//         const voterRegistration: VoterRegistered = {
//           rewardEpochId: parseIntOrThrow(tmp.rewardEpochId, 10),
//           voter: tmp.voter,
//           signingPolicyAddress: tmp.signingPolicyAddress,
//           delegationAddress: tmp.delegationAddress,
//           submitAddress: tmp.submitAddress,
//           submitSignaturesAddress: tmp.submitSignaturesAddress,
//         };
//         return voterRegistration;
//       });
//     return result;
//   }

//   // extractOffers(events: TLPEvents[]): RewardOffered[] {
//   //   const result = events
//   //     .filter((x: TLPEvents) => "0x" + x.topic0 === this.eventSignature("RewardOffered"))
//   //     .map(event => {
//   //       const offer = this.coder.decodeLog(
//   //         this.abiItems.get("RewardOffered")!.inputs!,
//   //         event.data,
//   //         [event.topic0, event.topic1, event.topic2, event.topic3].filter(x => x !== "")
//   //       );
//   //       return convertRewardOfferedEvent(offer as any as RewardOffered);
//   //     });
//   //   return result;
//   // }

//   extractCommitHash(txInput: string): string {
//     const commitMessage = this.extractMessage(txInput);
//     if (commitMessage === undefined) throw new Error("No commit message found for FTSO protocol in payload");
//     return commitMessage.payload;
//   }

//   private extractMessage(txInput: string) {
//     const callData = txInput.slice(8);
//     const messages = PayloadMessage.decode(callData);
//     return messages.find(x => x.protocolId === FTSO2_PROTOCOL_ID);
//   }

//   extractReveal(txInput: string): RevealData {
//     const revealMessage = this.extractMessage(txInput);
//     if (revealMessage === undefined) throw new Error("No commit message found for FTSO protocol in payload");
//     const reveal: RevealData = {
//       random: revealMessage.payload.slice(0, 66),
//       encodedPrices: "0x" + revealMessage.payload.slice(66),
//     };
//     console.log("Extracted reveal: ", reveal);
//     return reveal;
//   }

//   extractSignatures(tx: TxData): SignatureData {
//     const resultTmp = this.decodeFunctionCall(tx, "submitSignatures");

//     return {
//       epochId: parseIntOrThrow(resultTmp._priceEpochId, 10),
//       merkleRoot: resultTmp._merkleRoot,
//       v: parseIntOrThrow(resultTmp._signature.v, 10),
//       r: resultTmp._signature.r,
//       s: resultTmp._signature.s,
//     } as SignatureData;
//   }

//   extractFinalize(tx: TxData): FinalizeData {
//     const resultTmp = this.decodeFunctionCall(tx, "finalize");
//     const confirmation = tx.logs?.find((x: any) => x.topics[0] === this.eventSignature("MerkleRootConfirmed"));
//     return {
//       confirmed: confirmation !== undefined,
//       from: tx.from.toLowerCase(),
//       epochId: parseIntOrThrow(resultTmp._priceEpochId, 10),
//       merkleRoot: resultTmp._merkleRoot,
//       signatures: resultTmp._signatures.map((s: any) => {
//         return {
//           v: parseIntOrThrow(s.v, 10),
//           r: s.r,
//           s: s.s,
//         } as BareSignature;
//       }),
//     } as FinalizeData;
//   }

//   private decodeFunctionCall(tx: TxData, name: string) {
//     const encodedParameters = tx.input!.slice(10); // Drop the function signature
//     const parametersEncodingABI = this.abiItems.get(name)!.inputs!;
//     return this.coder.decodeParameters(parametersEncodingABI, encodedParameters);
//   }

//   private static _instance: EncodingUtils | undefined;
//   static get instance(): EncodingUtils {
//     if (this._instance === undefined) this._instance = new EncodingUtils();
//     return this._instance!;
//   }
// }

// function parseIntOrThrow(input: string, base: number): number {
//   const parsed: number = parseInt(input, base);
//   if (Number.isNaN(parsed)) throw new Error(`Could not parse ${input} as number`);
//   return parsed;
// }

// // /**
// //  * Converts an offer from web3 response to a more usable format, matching
// //  * the Offer interface.
// //  */
// // function convertRewardOfferedEvent(offer: any): RewardOffered {
// //   const newOffer = removeIndexFields(offer);
// //   delete newOffer.__length__;
// //   newOffer.leadProviders = [...offer.leadProviders];
// //   const result: RewardOffered = {
// //     ...newOffer,
// //     offerSymbol: bytes4ToText(newOffer.offerSymbol),
// //     quoteSymbol: bytes4ToText(newOffer.quoteSymbol),
// //     amount: toBN(newOffer.amount),
// //     flrValue: toBN(newOffer.flrValue),
// //     rewardBeltPPM: toBN(newOffer.rewardBeltPPM),
// //     elasticBandWidthPPM: toBN(newOffer.elasticBandWidthPPM),
// //     iqrSharePPM: toBN(newOffer.iqrSharePPM),
// //     pctSharePPM: toBN(newOffer.pctSharePPM),
// //   };
// //   return result;
// // }

// // /**
// //  * Removes annoying index fields from an object.
// //  */
// // function removeIndexFields<T>(obj: T): T {
// //   return Object.keys(obj as any)
// //     .filter(key => !key!.match(/^[0-9]+$/))
// //     .reduce((result: any, key: string) => {
// //       return Object.assign(result, {
// //         [key]: (obj as any)[key],
// //       });
// //     }, {}) as T;
// // }

// /**
//  * Converts bytes4 representation of a symbol to text.
//  */
// // export function bytes4ToText(bytes4: string) {
// //   if (!bytes4 || bytes4.length === 0) {
// //     throw new Error(`Bytes4 should be non-null and non-empty`);
// //   }
// //   if (!/^0x[0-9a-f]{8}$/i.test(bytes4)) {
// //     throw new Error(`Bytes4 should be a 4-byte hex string`);
// //   }
// //   return Web3.utils.hexToAscii(bytes4).replace(/\u0000/g, "");
// // }
