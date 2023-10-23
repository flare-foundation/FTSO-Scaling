import { readFileSync } from "fs";
import coder from "web3-eth-abi";
import { AbiItem, AbiInput } from "web3-utils/types";
import { BareSignature, FinalizeData, RevealBitvoteData, RewardOffered, SignatureData, TxData } from "../voting-types";
import { toBN } from "./voting-utils";
import Web3 from "web3";

const votingAbiPath = "artifacts/contracts/voting/implementation/Voting.sol/Voting.json";
const rewardsAbiPath = "artifacts/contracts/voting/implementation/VotingRewardManager.sol/VotingRewardManager.json";

export default class EncodingUtils {
  private functionSignatures = new Map<string, string>();
  private eventSignatures = new Map<string, string>();
  private abiItems = new Map<string, AbiItem>();
  private abiInputs = new Map<string, AbiInput>();

  private constructor() {
    const votingABI = JSON.parse(readFileSync(votingAbiPath).toString()).abi as AbiItem[];
    const rewardsABI = JSON.parse(readFileSync(rewardsAbiPath).toString()).abi as AbiItem[];

    this.abiItems.set("commit", votingABI.find((x: AbiItem) => x.name === "commit")!);
    this.abiItems.set("revealBitvote", votingABI.find((x: any) => x.name === "revealBitvote")!);
    this.abiItems.set("signResult", votingABI.find((x: any) => x.name === "signResult")!);
    this.abiItems.set("signRewards", votingABI.find((x: any) => x.name === "signRewards")!);
    this.abiItems.set("finalize", votingABI.find((x: any) => x.name === "finalize")!);
    this.abiItems.set("finalizeRewards", votingABI.find((x: any) => x.name === "finalizeRewards")!);
    this.abiItems.set("MerkleRootConfirmed", votingABI.find((x: any) => x.name === "MerkleRootConfirmed")!);
    this.abiItems.set("RewardMerkleRootConfirmed", votingABI.find((x: any) => x.name === "RewardMerkleRootConfirmed")!);
    this.abiItems.set("offerRewards", rewardsABI.find((x: any) => x.name === "offerRewards")!);
    this.abiItems.set("RewardOffered", rewardsABI.find((x: any) => x.name === "RewardOffered")!);
    this.abiInputs.set(
      "rewardClaimDefinition",
      rewardsABI.find((x: any) => x.name === "rewardClaimDefinition")!.inputs![0]
    );
    this.functionSignatures.set("commit", coder.encodeFunctionSignature(this.abiItems.get("commit")!));
    this.functionSignatures.set("revealBitvote", coder.encodeFunctionSignature(this.abiItems.get("revealBitvote")!));
    this.functionSignatures.set("signResult", coder.encodeFunctionSignature(this.abiItems.get("signResult")!));
    this.functionSignatures.set("signRewards", coder.encodeFunctionSignature(this.abiItems.get("signRewards")!));
    this.functionSignatures.set("offerRewards", coder.encodeFunctionSignature(this.abiItems.get("offerRewards")!));
    this.functionSignatures.set("finalize", coder.encodeFunctionSignature(this.abiItems.get("finalize")!));
    this.functionSignatures.set(
      "finalizeRewards",
      coder.encodeFunctionSignature(this.abiItems.get("finalizeRewards")!)
    );
    this.eventSignatures.set("RewardOffered", coder.encodeEventSignature(this.abiItems.get("RewardOffered")!));
    this.eventSignatures.set(
      "MerkleRootConfirmed",
      coder.encodeEventSignature(this.abiItems.get("MerkleRootConfirmed")!)
    );
    this.eventSignatures.set(
      "RewardMerkleRootConfirmed",
      coder.encodeEventSignature(this.abiItems.get("RewardMerkleRootConfirmed")!)
    );
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

  extractOffers(tx: TxData): RewardOffered[] {
    const result = tx
      .receipt!.logs.filter((x: any) => x.topics[0] === this.eventSignature("RewardOffered"))
      .map((event: any) => {
        const offer = coder.decodeLog(this.abiItems.get("RewardOffered")!.inputs!, event.data, event.topics);
        return convertRewardOfferedEvent(offer as any as RewardOffered);
      });
    return result;
  }

  extractCommitHash(tx: TxData): string {
    return this.decodeFunctionCall(tx, "commit")._commitHash;
  }

  extractRevealBitvoteData(tx: TxData): RevealBitvoteData {
    const resultTmp = this.decodeFunctionCall(tx, "revealBitvote");
    return {
      random: resultTmp._random,
      merkleRoot: resultTmp._merkleRoot,
      bitVote: resultTmp._bitVote,
      prices: resultTmp._prices,
    } as RevealBitvoteData;
  }

  extractSignatureData(tx: TxData): SignatureData {
    const resultTmp = this.decodeFunctionCall(tx, "signResult");

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
    const confirmation = tx.receipt!.logs.find((x: any) => x.topics[0] === this.eventSignature("MerkleRootConfirmed"));
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

  extractRewardSignatureData(tx: TxData): SignatureData {
    const resultTmp = this.decodeFunctionCall(tx, "signRewards");

    return {
      epochId: parseIntOrThrow(resultTmp._rewardEpochId, 10),
      merkleRoot: resultTmp._merkleRoot,
      v: parseIntOrThrow(resultTmp._signature.v, 10),
      r: resultTmp._signature.r,
      s: resultTmp._signature.s,
    } as SignatureData;
  }

  extractRewardFinalize(tx: TxData): FinalizeData {
    const resultTmp = this.decodeFunctionCall(tx, "finalizeRewards");
    const confirmation = tx.receipt!.logs.find(
      (x: any) => x.topics[0] === this.eventSignature("RewardMerkleRootConfirmed")
    );
    return {
      confirmed: confirmation !== undefined,
      from: tx.from.toLowerCase(),
      epochId: parseIntOrThrow(resultTmp._rewardEpochId, 10),
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
    return coder.decodeParameters(parametersEncodingABI, encodedParameters);
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
  let newOffer = removeIndexFields(offer);
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
