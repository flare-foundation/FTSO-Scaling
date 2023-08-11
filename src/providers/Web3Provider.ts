import { ContractAddresses } from "../../deployment/tasks/common";
import { Account } from "web3-core";

import {
  ClaimReward,
  Offer,
  EpochData,
  BareSignature,
  EpochResult,
  VoterWithWeight,
  BlockData,
  TxData,
  RewardOffered,
  RevealBitvoteData,
  SignatureData,
} from "../voting-interfaces";
import { IVotingProvider } from "./IVotingProvider";
import Web3 from "web3";
import { PriceOracle, VoterRegistry, Voting, VotingManager, VotingRewardManager } from "../../typechain-web3/contracts/voting/implementation";
import { getWeb3Contract, getWeb3Wallet } from "../utils";

interface Contracts {
  readonly votingRewardManager: VotingRewardManager;
  readonly voting: Voting;
  readonly voterRegistry: VoterRegistry;
  readonly priceOracle: PriceOracle;
  readonly votingManager: VotingManager;
}

export class Web3Provider implements IVotingProvider {
  private functionSignatures: Map<string, string> = new Map<string, string>();
  private eventSignatures: Map<string, string> = new Map<string, string>();
  private abis: Map<string, any> = new Map<string, string>();
  private wallet: Account;

  private constructor(
    readonly contractAddresses: ContractAddresses,
    readonly firstEpochStartSec: number,
    readonly epochDurationSec: number,
    readonly firstRewardedPriceEpoch: number,
    readonly rewardEpochDurationInEpochs: number,
    readonly signingDurationSec: number,
    readonly web3: Web3,
    private contracts: Contracts,
    privateKey: string,

  ) {
    this.setAbis();
    this.wallet = getWeb3Wallet(web3, privateKey);
  }

  static async create(contractAddresses: ContractAddresses, web3: Web3, privateKey: string) {
    const contracts = {
      votingRewardManager: await getWeb3Contract(web3, contractAddresses.voting, "VotingRewardManager"),
      voting: await getWeb3Contract(web3, contractAddresses.voting, "Voting"),
      voterRegistry:await getWeb3Contract(web3, contractAddresses.voting, "VoterRegistry"),
      priceOracle: await getWeb3Contract(web3, contractAddresses.voting, "PriceOracle"),
      votingManager:  await getWeb3Contract(web3, contractAddresses.voting, "VotingManager")
    } as Contracts;

    const firstEpochStartSec = (await contracts.votingManager.methods.BUFFER_TIMESTAMP_OFFSET()).toNumber();
    const epochDurationSec = (await contracts.votingManager.methods.BUFFER_WINDOW()).toNumber();
    const firstRewardedPriceEpoch = (await contracts.votingManager.methods.firstRewardedPriceEpoch()).toNumber();
    const rewardEpochDurationInEpochs = (await contracts.votingManager.methods.rewardEpochDurationInEpochs()).toNumber();
    const signingDurationSec = (await contracts.votingManager.methods.signingDurationSec()).toNumber();

    return new Web3Provider(
      contractAddresses,
      firstEpochStartSec,
      epochDurationSec,
      firstRewardedPriceEpoch,
      rewardEpochDurationInEpochs,
      signingDurationSec,
      web3,
      contracts,
      privateKey,
    );
  }

  abiForName(name: string) {
    throw new Error("Method not implemented.");
  }

  claimReward(claim: ClaimReward): Promise<any> {
    throw new Error("Method not implemented.");
  }
  offerRewards(offer: Offer[]): Promise<any> {
    throw new Error("Method not implemented.");
  }
  commit(hash: string): Promise<any> {
    throw new Error("Method not implemented.");
  }
  revealBitvote(epochData: EpochData): Promise<any> {
    throw new Error("Method not implemented.");
  }
  signResult(epochId: number, merkleRoot: string, signature: BareSignature): Promise<any> {
    throw new Error("Method not implemented.");
  }
  finalize(epochId: number, mySignatureHash: string, signatures: BareSignature[]): Promise<any> {
    throw new Error("Method not implemented.");
  }
  publishPrices(epochResult: EpochResult, symbolIndices: number[]): Promise<any> {
    throw new Error("Method not implemented.");
  }
  allVotersWithWeightsForRewardEpoch(rewardEpoch: number): Promise<VoterWithWeight[]> {
    throw new Error("Method not implemented.");
  }
  registerAsVoter(rewardEpochId: number, weight: number): Promise<any> {
    throw new Error("Method not implemented.");
  }
  signMessage(message: string): Promise<BareSignature> {
    throw new Error("Method not implemented.");
  }
  getBlockNumber(): Promise<number> {
    throw new Error("Method not implemented.");
  }
  getBlock(blockNumber: number): Promise<BlockData> {
    throw new Error("Method not implemented.");
  }
  getTransactionReceipt(txId: string): Promise<any> {
    throw new Error("Method not implemented.");
  }
  functionSignature(name: "commit" | "revealBitvote" | "signResult" | "offerRewards"): string {
    throw new Error("Method not implemented.");
  }
  eventSignature(name: "RewardOffered"): string {
    throw new Error("Method not implemented.");
  }
  get senderAddressLowercase(): string {
    throw new Error("Method not implemented.");
  }
  extractOffers(tx: TxData): RewardOffered[] {
    throw new Error("Method not implemented.");
  }
  extractCommitHash(tx: TxData): string {
    throw new Error("Method not implemented.");
  }
  extractRevealBitvoteData(tx: TxData): RevealBitvoteData {
    throw new Error("Method not implemented.");
  }
  extractSignatureData(tx: TxData): SignatureData {
    throw new Error("Method not implemented.");
  }
}
