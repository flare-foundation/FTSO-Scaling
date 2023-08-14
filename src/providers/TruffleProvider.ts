import { Account } from "web3-core";
import { ContractAddresses } from "../../deployment/tasks/common";
import {
  PriceOracleInstance,
  VoterRegistryInstance,
  VotingInstance,
  VotingManagerInstance,
  VotingRewardManagerInstance,
} from "../../typechain-truffle";
import { getContractAbis, getAccount } from "../web3-utils";
import {
  BareSignature,
  BlockData,
  ClaimReward,
  EpochData,
  EpochResult,
  Offer,
  RevealBitvoteData,
  RewardOffered,
  SignatureData,
  TxData,
  VoterWithWeight,
  deepCopyClaim,
} from "../voting-interfaces";
import { ZERO_ADDRESS, convertRewardOfferedEvent, hexlifyBN, toBN } from "../voting-utils";
import { IVotingProvider } from "./IVotingProvider";
import { readFileSync } from "fs";

export interface TruffleProviderOptions {
  readonly privateKey: string;
  readonly artifacts: Truffle.Artifacts;
  readonly web3: Web3;
}

interface TruffleContracts {
  readonly votingRewardManager: VotingRewardManagerInstance;
  readonly voting: VotingInstance;
  readonly voterRegistry: VoterRegistryInstance;
  readonly priceOracle: PriceOracleInstance;
  readonly votingManager: VotingManagerInstance;
}

/**
 * Implements IVotingProvider using Truffle library.
 * Intended for testing in hardhat environment.
 */
export class TruffleProvider implements IVotingProvider {
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
    readonly artifacts: Truffle.Artifacts,
    readonly web3: Web3,
    private contracts: TruffleContracts,
    privateKey: string
  ) {
    this.wallet = getAccount(web3, privateKey);
    [this.functionSignatures, this.eventSignatures, this.abis] = getContractAbis(web3);
  }

  assertWallet() {
    if (!this.wallet) {
      throw new Error("wallet not initialized");
    }
  }

  async claimReward(claim: ClaimReward): Promise<any> {
    const claimReward = deepCopyClaim(claim);
    delete claimReward.hash;
    return this.contracts.votingRewardManager.claimReward(hexlifyBN(claimReward), this.wallet.address, {
      from: this.wallet.address,
    });
  }

  async offerRewards(offers: Offer[]): Promise<any> {
    let totalAmount = toBN(0);
    offers.forEach(offer => {
      if (offer.currencyAddress === ZERO_ADDRESS) {
        totalAmount = totalAmount.add(offer.amount);
      }
    });
    return this.contracts.votingRewardManager.offerRewards(hexlifyBN(offers), {
      from: this.wallet.address,
      value: totalAmount,
    });
  }

  async commit(hash: string): Promise<any> {
    this.assertWallet();
    return this.contracts.voting.commit(hash, { from: this.wallet.address });
  }

  async revealBitvote(epochData: EpochData): Promise<any> {
    return this.contracts.voting.revealBitvote(
      epochData.random!,
      epochData.merkleRoot!,
      epochData.bitVote!,
      epochData.pricesHex!,
      { from: this.wallet.address }
    );
  }

  async signResult(epochId: number, merkleRoot: string, signature: BareSignature): Promise<any> {
    this.assertWallet();
    return this.contracts.voting.signResult(
      epochId,
      merkleRoot,
      {
        v: signature.v,
        r: signature.r,
        s: signature.s,
      },
      { from: this.wallet.address }
    );
  }

  async finalize(epochId: number, mySignatureHash: string, signatures: BareSignature[]) {
    this.assertWallet();
    return this.contracts.voting.finalize(epochId, mySignatureHash, signatures, { from: this.wallet.address });
  }

  async publishPrices(epochResult: EpochResult, symbolIndices: number[]): Promise<any> {
    this.assertWallet();
    return this.contracts.priceOracle.publishPrices(
      epochResult.dataMerkleRoot,
      epochResult.priceEpochId,
      epochResult.priceMessage,
      epochResult.symbolMessage,
      symbolIndices,
      { from: this.wallet.address }
    );
  }

  async signMessage(message: string): Promise<BareSignature> {
    this.assertWallet();
    const signature = this.wallet.sign(message);

    return <BareSignature>{
      v: parseInt(signature.v),
      r: signature.r,
      s: signature.s,
    };
  }

  async allVotersWithWeightsForRewardEpoch(rewardEpoch: number): Promise<VoterWithWeight[]> {
    const data = await this.contracts.voterRegistry.votersForRewardEpoch(rewardEpoch);
    const voters = data[0];
    const weights = data[1];
    const result: VoterWithWeight[] = [];
    for (let i = 0; i < voters.length; i++) {
      result.push({ voterAddress: voters[i], weight: weights[i], originalWeight: weights[i] });
    }
    return result;
  }

  async registerAsVoter(rewardEpochId: number, weight: number): Promise<any> {
    return await this.contracts.voterRegistry.registerAsAVoter(rewardEpochId, weight, { from: this.wallet.address });
  }

  async getBlockNumber(): Promise<number> {
    return this.web3.eth.getBlockNumber();
  }

  async getBlock(blockNumber: number): Promise<BlockData> {
    const result = await this.web3.eth.getBlock(blockNumber, true);
    result.timestamp = parseInt("" + result.timestamp, 10);
    return result as any as BlockData;
  }

  getTransactionReceipt(txId: string): Promise<any> {
    return this.web3.eth.getTransactionReceipt(txId);
  }

  functionSignature(name: "commit" | "revealBitvote" | "signResult" | "offerRewards"): string {
    return this.functionSignatures.get(name)!;
  }

  eventSignature(name: "RewardOffered"): string {
    return this.eventSignatures.get(name)!;
  }

  abiForName(name: "VotingRewardManager" | "PriceOracle" | "VoterRegistry" | "Voting" | "VotingManager") {
    return this.abis.get(name)!;
  }

  extractOffers(tx: TxData): RewardOffered[] {
    const result = tx
      .receipt!.logs.filter((x: any) => x.topics[0] === this.eventSignature("RewardOffered"))
      .map((event: any) => {
        const offer = this.web3.eth.abi.decodeLog(this.abis.get("RewardOffered").inputs, event.data, event.topics);
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

  get senderAddressLowercase(): string {
    this.assertWallet();
    return this.wallet.address.toLowerCase();
  }

  async getCurrentRewardEpochId(): Promise<number> {
    return (await this.contracts.votingManager.getCurrentRewardEpochId()).toNumber();
  }

  async getCurrentPriceEpochId(): Promise<number> {
    return (await this.contracts.votingManager.getCurrentPriceEpochId()).toNumber();
  }

  private decodeFunctionCall(tx: TxData, name: string) {
    const encodedParameters = tx.input!.slice(10); // Drop the function signature
    const parametersEncodingABI = this.abis.get(name)!.inputs;
    return this.web3.eth.abi.decodeParameters(parametersEncodingABI, encodedParameters);
  }

  static async create(contractAddresses: ContractAddresses, options: TruffleProviderOptions): Promise<TruffleProvider> {
    if (!options.privateKey) {
      throw new Error("privateKey not provided");
    }

    const VotingRewardManager = artifacts.require("VotingRewardManager");
    const Voting = artifacts.require("Voting");
    const VoterRegistry = artifacts.require("VoterRegistry");
    const PriceOracle = artifacts.require("PriceOracle");
    const VotingManager = artifacts.require("VotingManager");

    const contracts = {
      votingRewardManager: await VotingRewardManager.at(contractAddresses.votingRewardManager),
      voting: await Voting.at(contractAddresses.voting),
      voterRegistry: await VoterRegistry.at(contractAddresses.voterRegistry),
      priceOracle: await PriceOracle.at(contractAddresses.priceOracle),
      votingManager: await VotingManager.at(contractAddresses.votingManager),
    };

    const firstEpochStartSec = (await contracts.votingManager.BUFFER_TIMESTAMP_OFFSET()).toNumber();
    const epochDurationSec = (await contracts.votingManager.BUFFER_WINDOW()).toNumber();
    const firstRewardedPriceEpoch = (await contracts.votingManager.firstRewardedPriceEpoch()).toNumber();
    const rewardEpochDurationInEpochs = (await contracts.votingManager.rewardEpochDurationInEpochs()).toNumber();
    const signingDurationSec = (await contracts.votingManager.signingDurationSec()).toNumber();

    return new TruffleProvider(
      contractAddresses,
      firstEpochStartSec,
      epochDurationSec,
      firstRewardedPriceEpoch,
      rewardEpochDurationInEpochs,
      signingDurationSec,
      artifacts,
      web3,
      contracts,
      options.privateKey
    );
  }
}
