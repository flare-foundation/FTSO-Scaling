import { readFileSync } from "fs";
import coder from "web3-eth-abi";
import { AbiItem } from "web3-utils/types";
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
  private functionSignatures: Map<string, string> = new Map<string, string>();
  private eventSignatures: Map<string, string> = new Map<string, string>();
  private abis: Map<string, any> = new Map<string, string>();

  constructor() {
    const votingABI = JSON.parse(readFileSync(votingAbiPath).toString()).abi as AbiItem[];
    const rewardsABI = JSON.parse(readFileSync(rewardsAbiPath).toString()).abi as AbiItem[];

    this.abis.set(
      "commit",
      votingABI.find((x: any) => x.name === "commit")
    );
    this.abis.set(
      "revealBitvote",
      votingABI.find((x: any) => x.name === "revealBitvote")
    );
    this.abis.set(
      "signResult",
      votingABI.find((x: any) => x.name === "signResult")
    );
    this.abis.set(
      "finalize",
      votingABI.find((x: any) => x.name === "finalize")
    );
    this.abis.set(
      "offerRewards",
      rewardsABI.find((x: any) => x.name === "offerRewards")
    );
    this.abis.set(
      "claimRewardBodyDefinition",
      rewardsABI.find((x: any) => x.name === "claimRewardBodyDefinition")?.inputs?.[0]
    );
    this.abis.set(
      "RewardOffered",
      rewardsABI.find((x: any) => x.name === "RewardOffered")
    );
    this.functionSignatures.set("commit", coder.encodeFunctionSignature(this.abis.get("commit")));
    this.functionSignatures.set("revealBitvote", coder.encodeFunctionSignature(this.abis.get("revealBitvote")));
    this.functionSignatures.set("signResult", coder.encodeFunctionSignature(this.abis.get("signResult")));
    this.functionSignatures.set("offerRewards", coder.encodeFunctionSignature(this.abis.get("offerRewards")));
    this.functionSignatures.set("finalize", coder.encodeFunctionSignature(this.abis.get("finalize")));

    this.eventSignatures.set("RewardOffered", coder.encodeEventSignature(this.abis.get("RewardOffered")));
  }

  functionSignature(name: string): string {
    return this.functionSignatures.get(name)!;
  }

  eventSignature(name: string): string {
    return this.eventSignatures.get(name)!;
  }

  abiForName(name: string) {
    return this.abis.get(name)!;
  }

  extractOffers(tx: TxData): RewardOffered[] {
    const result = tx
      .receipt!.logs.filter((x: any) => x.topics[0] === this.eventSignature("RewardOffered"))
      .map((event: any) => {
        const offer = coder.decodeLog(this.abis.get("RewardOffered").inputs, event.data, event.topics);
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
      epochId: parseInt(resultTmp._epochId, 10),
      merkleRoot: resultTmp._merkleRoot,
      v: parseInt(resultTmp.signature.v, 10),
      r: resultTmp.signature.r,
      s: resultTmp.signature.s,
    } as SignatureData;
  }

  extractFinalize(tx: TxData): FinalizeData {
    const resultTmp = this.decodeFunctionCall(tx, "finalize");
    return {
      epochId: parseInt(resultTmp._epochId, 10),
      merkleRoot: resultTmp._merkleRoot,
      signatures: resultTmp.signatures.map((s: any) => {
        return {
          v: parseInt(s.v, 10),
          r: s.r,
          s: s.s,
        } as BareSignature;
      }),
    } as unknown as FinalizeData;
  }

  private decodeFunctionCall(tx: TxData, name: string) {
    const encodedParameters = tx.input!.slice(10); // Drop the function signature
    const parametersEncodingABI = this.abis.get(name)!.inputs;
    return coder.decodeParameters(parametersEncodingABI, encodedParameters);
  }
}

export const encodingUtils = new EncodingUtils();
