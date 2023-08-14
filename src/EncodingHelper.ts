import { readFileSync } from "fs";
import coder from "web3-eth-abi";
import { AbiItem } from "web3-utils/types";
import { RevealBitvoteData, RewardOffered, SignatureData, TxData } from "./voting-interfaces";
import { convertRewardOfferedEvent } from "./voting-utils";

export class EncodingHelper {
  private functionSignatures: Map<string, string> = new Map<string, string>();
  private eventSignatures: Map<string, string> = new Map<string, string>();
  private abis: Map<string, any> = new Map<string, string>();

  constructor() {
    const votingAbiPath = "artifacts/contracts/voting/implementation/Voting.sol/Voting.json";
    const rewardsAbiPath = "artifacts/contracts/voting/implementation/VotingRewardManager.sol/VotingRewardManager.json";
    const votingABI = JSON.parse(readFileSync(votingAbiPath).toString()).abi as AbiItem[];
    const rewardsABI = JSON.parse(readFileSync(rewardsAbiPath).toString()).abi as AbiItem[];

    const functionSignatures: Map<string, string> = new Map<string, string>();
    const eventSignatures: Map<string, string> = new Map<string, string>();
    const abis: Map<string, any> = new Map<string, string>();

    abis.set(
      "commit",
      votingABI.find((x: any) => x.name === "commit")
    );
    abis.set(
      "revealBitvote",
      votingABI.find((x: any) => x.name === "revealBitvote")
    );
    abis.set(
      "signResult",
      votingABI.find((x: any) => x.name === "signResult")
    );
    abis.set(
      "offerRewards",
      rewardsABI.find((x: any) => x.name === "offerRewards")
    );
    abis.set(
      "claimRewardBodyDefinition",
      rewardsABI.find((x: any) => x.name === "claimRewardBodyDefinition")?.inputs?.[0]
    );
    abis.set(
      "RewardOffered",
      rewardsABI.find((x: any) => x.name === "RewardOffered")
    );
    functionSignatures.set("commit", coder.encodeFunctionSignature(abis.get("commit")));
    functionSignatures.set("revealBitvote", coder.encodeFunctionSignature(abis.get("revealBitvote")));
    functionSignatures.set("signResult", coder.encodeFunctionSignature(abis.get("signResult")));
    functionSignatures.set("offerRewards", coder.encodeFunctionSignature(abis.get("offerRewards")));

    eventSignatures.set("RewardOffered", coder.encodeEventSignature(abis.get("RewardOffered")));
  }

  functionSignature(name: "commit" | "revealBitvote" | "signResult" | "offerRewards"): string {
    return this.functionSignatures.get(name)!;
  }

  eventSignature(name: "RewardOffered"): string {
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

  private decodeFunctionCall(tx: TxData, name: string) {
    const encodedParameters = tx.input!.slice(10); // Drop the function signature
    const parametersEncodingABI = this.abis.get(name)!.inputs;
    return coder.decodeParameters(parametersEncodingABI, encodedParameters);
  }
}
