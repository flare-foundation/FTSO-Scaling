import { BareSignature, BlockData, ClaimReward, EpochData, EpochResult, Offer, RevealBitvoteData, SignatureData, TxData } from "../voting-interfaces";
import BN from "bn.js";

export abstract class IVotingProvider {
   votingContractAddress: string;
   votingRewardManagerContractAddress: string;   
   voterRegistryContractAddress: string;
   priceOracleContractAddress: string;
   votingManagerContractAddress: string;

   firstEpochStartSec: number = 0;
   epochDurationSec: number = 0; 
   firstRewardedPriceEpoch: number = 0;
   rewardEpochDurationInEpochs: number = 0;
   signingDurationSec: number = 0;
 
   functionSignatures: Map<string, string> = new Map<string, string>();
   abiForName: Map<string, any> = new Map<string, any>();

   constructor(
      votingContractAddress: string,
      votingRewardManagerContractAddress: string,      
      voterRegistryContractAddress: string,
      priceOracleContractAddress: string,
      votingManagerContractAddress: string
   ) {
      this.votingContractAddress = votingContractAddress;
      this.votingRewardManagerContractAddress = votingRewardManagerContractAddress;      
      this.voterRegistryContractAddress = voterRegistryContractAddress;
      this.priceOracleContractAddress = priceOracleContractAddress;
      this.votingManagerContractAddress = votingManagerContractAddress;
   }

   abstract initialize(options?: any): Promise<void>;

   abstract claimReward(claim: ClaimReward): Promise<any>;
   abstract offerRewards(offer: Offer[]): Promise<any>;
   abstract commit(hash: string): Promise<any>;
   abstract revealBitvote(epochData: EpochData): Promise<any>;
   abstract signResult(epochId: number, merkleRoot: string, signature: BareSignature): Promise<any>;
   abstract finalize(epochId: number, mySignatureHash: string, signatures: BareSignature[]): Promise<any>;
   abstract publishPrices(epochResult: EpochResult, symbolIndices: number[]): Promise<any>;
   abstract voterWeightsInRewardEpoch(rewardEpoch: number, voters: string[]): Promise<BN[]>;
   abstract signMessage(message: string): Promise<BareSignature>;

   abstract getBlockNumber(): Promise<number>;
   abstract getBlock(blockNumber: number): Promise<BlockData>;
   abstract functionSignature(name: string): string;

   hashMessage(message: string): string {
      if (!message.startsWith("0x")) {
         throw new Error("Message must be hex string prefixed with 0x");
      }
      return web3.utils.soliditySha3(message)!;
   }


   abstract extractOffers(tx: TxData): Offer[];
   abstract extractCommitHash(tx: TxData): string;
   abstract extractRevealBitvoteData(tx: TxData): RevealBitvoteData;
   abstract extractSignatureData(tx: TxData): SignatureData;
   abstract get senderAddressLowercase(): string;
}