import { readFileSync } from "fs";
import coder from "web3-eth-abi";
import { AbiItem, AbiInput } from "web3-utils/types";
import {
  BareSignature,
  FinalizeData,
  RevealBitvoteData,
  RewardOffered,
  SignatureData,
  TxData,
} from "./voting-interfaces";
import { convertRewardOfferedEvent } from "./voting-utils";

const votingAbiPath = "artifacts/contracts/voting/implementation/Voting.sol/Voting.json";
const rewardsAbiPath = "artifacts/contracts/voting/implementation/VotingRewardManager.sol/VotingRewardManager.json";

class EncodingUtils {
  private functionSignatures = new Map<string, string>();
  private eventSignatures = new Map<string, string>();
  private abiItems = new Map<string, AbiItem>();
  private abiInputs = new Map<string, AbiInput>();

  constructor() {
    const votingABI = JSON.parse(readFileSync(votingAbiPath).toString()).abi as AbiItem[];
    const rewardsABI = JSON.parse(readFileSync(rewardsAbiPath).toString()).abi as AbiItem[];

    this.abiItems.set("commit", votingABI.find((x: AbiItem) => x.name === "commit")!);
    this.abiItems.set("revealBitvote", votingABI.find((x: any) => x.name === "revealBitvote")!);
    this.abiItems.set("signResult", votingABI.find((x: any) => x.name === "signResult")!);
    this.abiItems.set("finalize", votingABI.find((x: any) => x.name === "finalize")!);
    this.abiItems.set("offerRewards", rewardsABI.find((x: any) => x.name === "offerRewards")!);
    this.abiItems.set("RewardOffered", rewardsABI.find((x: any) => x.name === "RewardOffered")!);
    this.abiInputs.set(
      "rewardClaimDefinition",
      rewardsABI.find((x: any) => x.name === "rewardClaimDefinition")!.inputs![0]
    );
    this.functionSignatures.set("commit", coder.encodeFunctionSignature(this.abiItems.get("commit")!));
    this.functionSignatures.set("revealBitvote", coder.encodeFunctionSignature(this.abiItems.get("revealBitvote")!));
    this.functionSignatures.set("signResult", coder.encodeFunctionSignature(this.abiItems.get("signResult")!));
    this.functionSignatures.set("offerRewards", coder.encodeFunctionSignature(this.abiItems.get("offerRewards")!));
    this.functionSignatures.set("finalize", coder.encodeFunctionSignature(this.abiItems.get("finalize")!));
    this.eventSignatures.set("RewardOffered", coder.encodeEventSignature(this.abiItems.get("RewardOffered")!));
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
      v: parseIntOrThrow(resultTmp.signature.v, 10),
      r: resultTmp.signature.r,
      s: resultTmp.signature.s,
    } as SignatureData;
  }

  extractFinalize(tx: TxData): FinalizeData {
    const resultTmp = this.decodeFunctionCall(tx, "finalize");
    return {
      from: tx.from.toLowerCase(),
      epochId: parseIntOrThrow(resultTmp._priceEpochId, 10),
      merkleRoot: resultTmp._merkleRoot,
      signatures: resultTmp.signatures.map((s: any) => {
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
}

function parseIntOrThrow(input: string, base: number):number {
  const parsed: number = parseInt(input, base);
  if (Number.isNaN(parsed)) throw new Error(`Could not parse ${input} as number`);
  return parsed;
}

export const encodingUtils = new EncodingUtils();
