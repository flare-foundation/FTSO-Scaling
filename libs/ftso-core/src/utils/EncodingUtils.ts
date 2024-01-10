import { readFileSync } from "fs";
import { AbiItem, AbiInput } from "web3-utils/types";
import { BareSignature, FinalizeData, RevealData, RewardOffered, SignatureData, TxData } from "../voting-types";
import { toBN } from "./voting-utils";
import Web3 from "web3";
import { TLPEvents } from "../orm/entities";
import BN from "bn.js";
import { PayloadMessage } from "./PayloadMessage";

export const FTSO2_PROTOCOL_ID = 100;

const submissionAbiPath = "abi/Submission.json";
const systemManagerAbiPath = "abi/FlareSystemManager.json";
const relayAbiPath = "abi/Relay.json";
const voterRegistryAbiPath = "abi/VoterRegistry.json";

const commitFunction = "submit1";
const revealFunction = "submit2";
const signFunction = "submitSignatures";
export interface SigningPolicy {
  rewardEpochId: number;
  startVotingRoundId: number;
  threshold: BN;
  seed: BN;
  voters: string[];
  weights: BN[];
}

export interface VoterRegistered {
  rewardEpochId: number;
  voter: string;
  signingPolicyAddress: string;
  delegationAddress: string;
  submitAddress: string;
  submitSignaturesAddress: string;
}

export default class EncodingUtils {
  private functionSignatures = new Map<string, string>();
  private eventSignatures = new Map<string, string>();
  private abiItems = new Map<string, AbiItem>();
  private abiInputs = new Map<string, AbiInput>();

  private coder = new Web3().eth.abi;

  private constructor() {
    const systemManagerAbi = JSON.parse(readFileSync(systemManagerAbiPath).toString()).abi as AbiItem[];
    const relayAbi = JSON.parse(readFileSync(relayAbiPath).toString()).abi as AbiItem[];
    const submissionAbi = JSON.parse(readFileSync(submissionAbiPath).toString()).abi as AbiItem[];
    const voterRegistryAbi = JSON.parse(readFileSync(voterRegistryAbiPath).toString()).abi as AbiItem[];

    this.abiItems.set(commitFunction, submissionAbi.find((x: AbiItem) => x.name === commitFunction)!);
    this.abiItems.set(revealFunction, submissionAbi.find(x => x.name === revealFunction)!);
    this.abiItems.set(signFunction, submissionAbi.find(x => x.name === signFunction)!);

    // this.abiItems.set("finalize", votingABI.find(x => x.name === "finalize")!);
    this.abiItems.set("SigningPolicyInitialized", relayAbi.find(x => x.name === "SigningPolicyInitialized")!);
    this.abiItems.set("VoterRegistered", voterRegistryAbi.find(x => x.name === "VoterRegistered")!);
    // this.abiItems.set("RewardMerkleRootConfirmed", votingABI.find(x => x.name === "RewardMerkleRootConfirmed")!);
    // this.abiItems.set("offerRewards", rewardsABI.find(x => x.name === "offerRewards")!);
    // this.abiItems.set("RewardOffered", rewardsABI.find(x => x.name === "RewardOffered")!);
    // this.abiInputs.set("rewardClaimDefinition", rewardsABI.find(x => x.name === "rewardClaimDefinition")!.inputs![0]);

    this.functionSignatures.set(commitFunction, this.coder.encodeFunctionSignature(this.abiItems.get(commitFunction)!));
    this.functionSignatures.set(revealFunction, this.coder.encodeFunctionSignature(this.abiItems.get(revealFunction)!));
    this.functionSignatures.set(signFunction, this.coder.encodeFunctionSignature(this.abiItems.get(signFunction)!));
    // this.functionSignatures.set("offerRewards", this.coder.encodeFunctionSignature(this.abiItems.get("offerRewards")!));
    // this.functionSignatures.set("finalize", this.coder.encodeFunctionSignature(this.abiItems.get("finalize")!));

    // this.eventSignatures.set("RewardOffered", this.coder.encodeEventSignature(this.abiItems.get("RewardOffered")!));
    // this.eventSignatures.set(
    //   "MerkleRootConfirmed",
    //   this.coder.encodeEventSignature(this.abiItems.get("MerkleRootConfirmed")!)
    // );
    this.eventSignatures.set(
      "SigningPolicyInitialized",
      this.coder.encodeEventSignature(this.abiItems.get("SigningPolicyInitialized")!)
    );
    this.eventSignatures.set("VoterRegistered", this.coder.encodeEventSignature(this.abiItems.get("VoterRegistered")!));
  }

  functionSignature(name: string): string {
    return this.functionSignatures.get(name)!;
  }

  eventSignature(name: string): string {
    return this.eventSignatures.get(name)!;
  }

  abiItemForName(name: string) {
    return this.abiItems.get(name)!;
  }

  abiInputForName(name: string) {
    return this.abiInputs.get(name)!;
  }
  /*
  "rewardEpochId": "6",
    "startVotingRoundId": "1030",
    "threshold": "32766",
    "seed": "53065328510085082331184441339942221355359738731470047888994380383026852146168",
    "voters": [
      "0x3d91185a02774C70287F6c74Dd26d13DFB58ff16",
      "0x0a057a7172d0466AEF80976D7E8c80647DfD35e3",
      "0x650240A1F1024Fe55e6F2ed56679aB430E338581",
      "0x2E3bfF5d8F20FDb941adC794F9BF3deA0416988f"
    ],
    "weights": [
      "16383",
      "16383",
      "16383",
      "16383"
    ],
  */

  extractSigningPolicies(events: TLPEvents[]): SigningPolicy[] {
    const result = events
      .filter((x: TLPEvents) => x.topic0 === this.eventSignature("SigningPolicyInitialized").slice(2))
      .map(event => {
        const rawPolicy = this.coder.decodeLog(
          this.abiItems.get("SigningPolicyInitialized")!.inputs!,
          event.data,
          [event.topic0, event.topic1, event.topic2, event.topic3].filter(x => x !== "")
        );
        const tmp = rawPolicy as any;
        const policy: SigningPolicy = {
          rewardEpochId: parseIntOrThrow(tmp.rewardEpochId, 10),
          startVotingRoundId: parseIntOrThrow(tmp.startVotingRoundId, 10),
          threshold: toBN(tmp.threshold),
          seed: toBN(tmp.seed),
          voters: tmp.voters,
          weights: tmp.weights.map((x: any) => toBN(x)),
        };
        return policy;
      });
    return result;
  }

  extractVoterRegistration(events: TLPEvents[]): VoterRegistered[] {
    const result = events
      .filter((x: TLPEvents) => x.topic0 === this.eventSignature("VoterRegistered").slice(2))
      .map(event => {
        const raw = this.coder.decodeLog(
          this.abiItems.get("VoterRegistered")!.inputs!,
          event.data,
          [event.topic0, event.topic1, event.topic2, event.topic3].filter(x => x !== "")
        );
        const tmp = raw as any;
        const voterRegistration: VoterRegistered = {
          rewardEpochId: parseIntOrThrow(tmp.rewardEpochId, 10),
          voter: tmp.voter,
          signingPolicyAddress: tmp.signingPolicyAddress,
          delegationAddress: tmp.delegationAddress,
          submitAddress: tmp.submitAddress,
          submitSignaturesAddress: tmp.submitSignaturesAddress,
        };
        return voterRegistration;
      });
    return result;
  }

  extractOffers(events: TLPEvents[]): RewardOffered[] {
    const result = events
      .filter((x: TLPEvents) => "0x" + x.topic0 === this.eventSignature("RewardOffered"))
      .map(event => {
        const offer = this.coder.decodeLog(
          this.abiItems.get("RewardOffered")!.inputs!,
          event.data,
          [event.topic0, event.topic1, event.topic2, event.topic3].filter(x => x !== "")
        );
        return convertRewardOfferedEvent(offer as any as RewardOffered);
      });
    return result;
  }

  extractCommitHash(txInput: string): string {
    const commitMessage = this.extractMessage(txInput);
    if (commitMessage === undefined) throw new Error("No commit message found for FTSO protocol in payload");
    return commitMessage.payload;
  }

  private extractMessage(txInput: string) {
    const callData = txInput.slice(8);
    const messages = PayloadMessage.decode(callData);
    return messages.find(x => x.protocolId === FTSO2_PROTOCOL_ID);
  }

  extractReveal(txInput: string): RevealData {
    const revealMessage = this.extractMessage(txInput);
    if (revealMessage === undefined) throw new Error("No commit message found for FTSO protocol in payload");
    const reveal: RevealData = {
      random: revealMessage.payload.slice(0, 66),
      encodedPrices: "0x" + revealMessage.payload.slice(66),
    };
    console.log("Extracted reveal: ", reveal);
    return reveal;
  }

  extractSignatures(tx: TxData): SignatureData {
    const resultTmp = this.decodeFunctionCall(tx, "submitSignatures");

    return {
      epochId: parseIntOrThrow(resultTmp._priceEpochId, 10),
      merkleRoot: resultTmp._merkleRoot,
      v: parseIntOrThrow(resultTmp._signature.v, 10),
      r: resultTmp._signature.r,
      s: resultTmp._signature.s,
    } as SignatureData;
  }

  extractFinalize(tx: TxData): FinalizeData {
    const resultTmp = this.decodeFunctionCall(tx, "finalize");
    const confirmation = tx.logs?.find((x: any) => x.topics[0] === this.eventSignature("MerkleRootConfirmed"));
    return {
      confirmed: confirmation !== undefined,
      from: tx.from.toLowerCase(),
      epochId: parseIntOrThrow(resultTmp._priceEpochId, 10),
      merkleRoot: resultTmp._merkleRoot,
      signatures: resultTmp._signatures.map((s: any) => {
        return {
          v: parseIntOrThrow(s.v, 10),
          r: s.r,
          s: s.s,
        } as BareSignature;
      }),
    } as FinalizeData;
  }

  private decodeFunctionCall(tx: TxData, name: string) {
    const encodedParameters = tx.input!.slice(10); // Drop the function signature
    const parametersEncodingABI = this.abiItems.get(name)!.inputs!;
    return this.coder.decodeParameters(parametersEncodingABI, encodedParameters);
  }

  private static _instance: EncodingUtils | undefined;
  static get instance(): EncodingUtils {
    if (this._instance === undefined) this._instance = new EncodingUtils();
    return this._instance!;
  }
}

function parseIntOrThrow(input: string, base: number): number {
  const parsed: number = parseInt(input, base);
  if (Number.isNaN(parsed)) throw new Error(`Could not parse ${input} as number`);
  return parsed;
}

/**
 * Converts an offer from web3 response to a more usable format, matching
 * the Offer interface.
 */
function convertRewardOfferedEvent(offer: any): RewardOffered {
  const newOffer = removeIndexFields(offer);
  delete newOffer.__length__;
  newOffer.leadProviders = [...offer.leadProviders];
  const result: RewardOffered = {
    ...newOffer,
    offerSymbol: bytes4ToText(newOffer.offerSymbol),
    quoteSymbol: bytes4ToText(newOffer.quoteSymbol),
    amount: toBN(newOffer.amount),
    flrValue: toBN(newOffer.flrValue),
    rewardBeltPPM: toBN(newOffer.rewardBeltPPM),
    elasticBandWidthPPM: toBN(newOffer.elasticBandWidthPPM),
    iqrSharePPM: toBN(newOffer.iqrSharePPM),
    pctSharePPM: toBN(newOffer.pctSharePPM),
  };
  return result;
}

/**
 * Removes annoying index fields from an object.
 */
function removeIndexFields<T>(obj: T): T {
  return Object.keys(obj as any)
    .filter(key => !key!.match(/^[0-9]+$/))
    .reduce((result: any, key: string) => {
      return Object.assign(result, {
        [key]: (obj as any)[key],
      });
    }, {}) as T;
}

/**
 * Converts bytes4 representation of a symbol to text.
 */
export function bytes4ToText(bytes4: string) {
  if (!bytes4 || bytes4.length === 0) {
    throw new Error(`Bytes4 should be non-null and non-empty`);
  }
  if (!/^0x[0-9a-f]{8}$/i.test(bytes4)) {
    throw new Error(`Bytes4 should be a 4-byte hex string`);
  }
  return Web3.utils.hexToAscii(bytes4).replace(/\u0000/g, "");
}
