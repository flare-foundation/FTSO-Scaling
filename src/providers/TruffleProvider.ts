import BN from "bn.js";
import fs from "fs";
import { artifacts, web3 } from "hardhat";
import { AbiItem } from "web3-utils";
import { PriceOracleInstance, VoterRegistryInstance, VotingInstance, VotingManagerInstance, VotingRewardManagerInstance } from "../../typechain-truffle";
import { BareSignature, ClaimReward, EpochData, EpochResult, Offer, RevealBitvoteData, SignatureData, TxData } from "../voting-interfaces";
import { IVotingProvider } from "./IVotingProvider";
import { convertOfferFromWeb3Response } from "../voting-utils";

let VotingRewardManager = artifacts.require("VotingRewardManager");
let Voting = artifacts.require("Voting");
let VoterRegistry = artifacts.require("VoterRegistry");
let PriceOracle = artifacts.require("PriceOracle");
let VotingManager = artifacts.require("VotingManager");

export class TruffleProvider extends IVotingProvider {
   votingRewardManagerContract!: VotingRewardManagerInstance;
   votingContract!: VotingInstance;
   voterRegistryContract!: VoterRegistryInstance;
   priceOracleContract!: PriceOracleInstance;
   votingManagerContract!: VotingManagerInstance;

   async initialize(): Promise<void> {
      let votingAbiPath = "artifacts/contracts/voting/implementation/Voting.sol/Voting.json"
      let rewardsAbiPath = "artifacts/contracts/voting/implementation/VotingRewardManager.sol/VotingRewardManager.json";
      // let voterRegistryAbiPath = "artifacts/contracts/voting/implementation/VoterRegistry.sol/VoterRegistry.json";

      let votingABI = JSON.parse(fs.readFileSync(votingAbiPath).toString()).abi as AbiItem[];
      let rewardsABI = JSON.parse(fs.readFileSync(rewardsAbiPath).toString()).abi as AbiItem[];
      // let voterRegistryABI = JSON.parse(fs.readFileSync(votingAbiPath).toString()).abi as AbiItem[];

      this.abiForName.set("commit", votingABI.find((x: any) => x.name === "commit"));
      this.abiForName.set("revealBitvote", votingABI.find((x: any) => x.name === "revealBitvote"));
      this.abiForName.set("signResult", votingABI.find((x: any) => x.name === "signResult"));
      this.abiForName.set("offerRewards", rewardsABI.find((x: any) => x.name === "offerRewards"));
      this.abiForName.set("claimRewardBodyDefinition", rewardsABI.find((x: any) => x.name === "claimRewardBodyDefinition")?.inputs?.[0]);

      this.functionSignatures.set("commit", web3.eth.abi.encodeFunctionSignature(this.abiForName.get("commit")));
      this.functionSignatures.set("revealBitvote", web3.eth.abi.encodeFunctionSignature(this.abiForName.get("revealBitvote")));
      this.functionSignatures.set("signResult", web3.eth.abi.encodeFunctionSignature(this.abiForName.get("signResult")));
      this.functionSignatures.set("offerRewards", web3.eth.abi.encodeFunctionSignature(this.abiForName.get("offerRewards")));

      // contracts

      this.votingRewardManagerContract = await VotingRewardManager.at(this.votingRewardManagerContractAddress);
      this.votingContract = await Voting.at(this.votingContractAddress);
      this.voterRegistryContract = await VoterRegistry.at(this.voterRegistryContractAddress);
      this.priceOracleContract = await PriceOracle.at(this.priceOracleContractAddress);
      this.votingManagerContract = await VotingManager.at(this.votingManagerContractAddress);

      this.firstEpochStartSec = await this.votingManagerContract.BUFFER_TIMESTAMP_OFFSET();
      this.epochDurationSec = await this.votingManagerContract.BUFFER_WINDOW();
      this.firstRewardedPriceEpoch = await this.votingManagerContract.firstRewardedPriceEpoch();
      this.rewardEpochDurationInEpochs = await this.votingManagerContract.rewardEpochDurationInEpochs();
      this.signingDurationSec = await this.votingManagerContract.signingDurationSec();
   }

   async claimReward(claim: ClaimReward): Promise<any> {
      return this.votingRewardManagerContract.claimReward(claim);
   }

   async offerRewards(offers: Offer[]): Promise<any> {
      return this.votingRewardManagerContract.offerRewards(offers);
   }

   async commit(hash: string, from?: string | undefined): Promise<any> {
      return this.votingContract.commit(hash, { from });
   }

   async revealBitvote(epochData: EpochData, from?: string | undefined): Promise<any> {
      return this.votingContract.revealBitvote(epochData.random!, epochData.merkleRoot!, epochData.bitVote!, epochData.pricesHex!, { from });
   }

   async signResult(epochId: number, merkleRoot: string, signature: BareSignature, from?: string | undefined): Promise<any> {
      return this.votingContract.signResult(epochId,
         merkleRoot,
         {
            v: signature.v,
            r: signature.r,
            s: signature.s
         }, { from });
   }

   async finalize(epochId: number, mySignatureHash: string, signatures: BareSignature[], from?: string | undefined) {
      return this.votingContract.finalize(epochId, mySignatureHash, signatures, { from });
   }

   async publishPrices(epochResult: EpochResult, from?: string | undefined): Promise<any> {
      return this.priceOracleContract.publishPrices(epochResult.dataMerkleRoot, epochResult.fullPriceMessage, { from });
   }

   async voterWeightsInRewardEpoch(rewardEpoch: number, voters: string[]): Promise<BN[]> {
      return this.voterRegistryContract.voterWeightsInRewardEpoch(rewardEpoch, voters);
   }

   async getBlockNumber(): Promise<number> {
      return web3.eth.getBlockNumber();
   }

   functionSignature(name: string): string {
      return this.functionSignatures.get(name)!;
   }

   hashMessage(message: string): string {
      if (!message.startsWith("0x")) {
         throw new Error("Message must be hex string prefixed with 0x");
      }
      return web3.utils.soliditySha3(message)!;
   }

   extractOffers(tx: TxData): Offer[] {
      let offers: Offer[] = web3.eth.abi.decodeParameter(this.abiForName.get("offerRewards")!.inputs[0], tx.input!.slice(10)) as Offer[];
      return offers.map(offer => convertOfferFromWeb3Response(offer));
   }

   extractCommitHash(tx: TxData): string {
      return web3.eth.abi.decodeParameters(this.abiForName.get("commit")!.inputs, tx.input?.slice(10)!)?._commitHash;
   }

   extractRevealBitvoteData(tx: TxData): RevealBitvoteData {
      const resultTmp = web3.eth.abi.decodeParameters(this.abiForName.get("revealBitvote")!.inputs, tx.input?.slice(10)!);
      return {
         random: resultTmp._random,
         merkleRoot: resultTmp._merkleRoot,
         bitVote: resultTmp._bitVote,
         prices: resultTmp._prices
      } as RevealBitvoteData;
   }

   extractSignatureData(tx: TxData): SignatureData {
      const resultTmp = web3.eth.abi.decodeParameters(this.abiForName.get("signResult")!.inputs, tx.input?.slice(10)!);
      return {
         epochId: parseInt(resultTmp._epochId, 10),
         merkleRoot: resultTmp._merkleRoot,
         v: parseInt(resultTmp.signature.v, 10),
         r: resultTmp.signature.r,
         s: resultTmp.signature.s
      } as SignatureData;
   }

}