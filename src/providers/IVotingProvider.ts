import { BareSignature, BlockData, ClaimReward, EpochData, EpochResult, Offer, RewardOffered, RevealBitvoteData, SignatureData, TxData, VoterWithWeight } from "../voting-interfaces";
import BN from "bn.js";

/**
 * An abstract class of a Voting provider. The role of a Voting provider is to
 * provide a generic interface to blockchain calls needed by the FTSO providers 
 * hence abstracting away specifics of the blockchain interacting implementation 
 * and wallet usage.
 */
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
   eventSignatures: Map<string, string> = new Map<string, string>();
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

   /**
    * Carries out initialization of the Voting provider.
    * @param options 
    */
   abstract initialize(options?: any): Promise<void>;

   ////////////// Contract calls //////////////
   abstract claimReward(claim: ClaimReward): Promise<any>;
   abstract offerRewards(offer: Offer[]): Promise<any>;
   abstract commit(hash: string): Promise<any>;
   abstract revealBitvote(epochData: EpochData): Promise<any>;
   abstract signResult(epochId: number, merkleRoot: string, signature: BareSignature): Promise<any>;
   abstract finalize(epochId: number, mySignatureHash: string, signatures: BareSignature[]): Promise<any>;
   abstract publishPrices(epochResult: EpochResult, symbolIndices: number[]): Promise<any>;
   abstract allVotersWithWeightsForRewardEpoch(rewardEpoch: number): Promise<VoterWithWeight[]>;


   ////////////// Signing //////////////
   abstract signMessage(message: string): Promise<BareSignature>;

   ////////////// Block calls //////////////
   abstract getBlockNumber(): Promise<number>;
   abstract getBlock(blockNumber: number): Promise<BlockData>;
   abstract getTransactionReceipt(txId: string): Promise<any>;
   ////////////// Auxiliary //////////////
   abstract functionSignature(name: "commit" | "revealBitvote" | "signResult" | "offerRewards"): string;
   abstract eventSignature(name: "RewardOffered"): string;


   /**
    * Hashes a message. 
    * @param message 
    * @returns 
    */
   hashMessage(message: string): string {
      if (!message.startsWith("0x")) {
         throw new Error("Message must be hex string prefixed with 0x");
      }
      return web3.utils.soliditySha3(message)!;
   }

   abstract get senderAddressLowercase(): string;

   ////////////// Transaction and event data extraction methods //////////////

   abstract extractOffers(tx: TxData): RewardOffered[];
   abstract extractCommitHash(tx: TxData): string;
   abstract extractRevealBitvoteData(tx: TxData): RevealBitvoteData;
   abstract extractSignatureData(tx: TxData): SignatureData;

}