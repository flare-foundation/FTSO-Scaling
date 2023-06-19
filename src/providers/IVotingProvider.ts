import { BareSignature, ClaimReward, EpochData, EpochResult, Offer } from "../voting-interfaces";
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

   abstract initialize(): Promise<void>;

   abstract claimReward(claim: ClaimReward): Promise<any>;
   abstract offerRewards(offer: Offer[]): Promise<any>;
   abstract commit(hash: string, from?: string): Promise<any>;
   abstract revealBitvote(epochData: EpochData, from?: string | undefined): Promise<any>;
   abstract signResult(epochId: number, merkleRoot: string, signature: BareSignature, from?: string): Promise<any>;
   abstract finalize(epochId: number, mySignatureHash: string, signatures: BareSignature[], from?: string): Promise<any>;
   abstract publishPrices(epochResult: EpochResult, from?: string | undefined): Promise<any>;
   abstract voterWeightsInRewardEpoch(rewardEpoch: number, voters: string[]): Promise<BN[]>;

   abstract getBlockNumber(): Promise<number>;
   abstract functionSignature(name: string): string;
}