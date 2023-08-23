import { Account } from "web3-core";
import { ContractAddresses } from "../../deployment/tasks/common";
import {
  PriceOracleInstance,
  VoterRegistryInstance,
  VotingInstance,
  VotingManagerInstance,
  VotingRewardManagerInstance,
} from "../../typechain-truffle";
import {
  BareSignature,
  BlockData,
  ClaimReward,
  EpochData,
  EpochResult,
  Offer,
  VoterWithWeight,
  deepCopyClaim,
} from "../voting-interfaces";
import { ZERO_ADDRESS, hexlifyBN, toBN } from "../voting-utils";
import { getAccount } from "../web3-utils";
import { IVotingProvider } from "./IVotingProvider";

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
  private account: Account;

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
    this.account = getAccount(web3, privateKey);
  }

  async thresholdForRewardEpoch(epochId: number): Promise<BN> {
    return this.contracts.voterRegistry.thresholdForRewardEpoch(epochId);
  }

  async claimReward(claim: ClaimReward): Promise<any> {
    const claimReward = deepCopyClaim(claim);
    delete claimReward.hash;
    return this.contracts.votingRewardManager.claimReward(hexlifyBN(claimReward), this.account.address, {
      from: this.account.address,
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
      from: this.account.address,
      value: totalAmount,
    });
  }

  async commit(hash: string): Promise<any> {
    return this.contracts.voting.commit(hash, { from: this.account.address });
  }

  async revealBitvote(epochData: EpochData): Promise<any> {
    return this.contracts.voting.revealBitvote(
      epochData.random!,
      epochData.merkleRoot!,
      epochData.bitVote!,
      epochData.pricesHex!,
      { from: this.account.address }
    );
  }

  async signResult(epochId: number, merkleRoot: string, signature: BareSignature): Promise<any> {
    return this.contracts.voting.signResult(
      epochId,
      merkleRoot,
      {
        v: signature.v,
        r: signature.r,
        s: signature.s,
      },
      { from: this.account.address }
    );
  }

  async finalize(epochId: number, mySignatureHash: string, signatures: BareSignature[]): Promise<boolean> {
    try {
      await this.contracts.voting.finalize(epochId, mySignatureHash, signatures, {
        from: this.account.address,
      });
      return true;
    } catch (e) {
      if ((e as any).message.includes("already finalized")) {
        return false;
      } else throw e;
    }
  }

  async publishPrices(epochResult: EpochResult, symbolIndices: number[]): Promise<any> {
    return this.contracts.priceOracle.publishPrices(
      epochResult.dataMerkleRoot,
      epochResult.priceEpochId,
      epochResult.priceMessage,
      epochResult.symbolMessage,
      symbolIndices,
      { from: this.account.address }
    );
  }

  async signMessage(message: string): Promise<BareSignature> {
    const signature = this.account.sign(message);

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
    return await this.contracts.voterRegistry.registerAsAVoter(rewardEpochId, weight, { from: this.account.address });
  }

  async getBlockNumber(): Promise<number> {
    return this.web3.eth.getBlockNumber();
  }

  async getBlock(blockNumber: number): Promise<BlockData> {
    const block = (await this.web3.eth.getBlock(blockNumber, true)) as any as BlockData;
    block.timestamp = parseInt("" + block.timestamp, 10);
    for (const tx of block.transactions) {
      tx.receipt = await this.web3.eth.getTransactionReceipt(tx.hash);
    }
    return block;
  }

  get senderAddressLowercase(): string {
    return this.account.address.toLowerCase();
  }

  async getCurrentRewardEpochId(): Promise<number> {
    return (await this.contracts.votingManager.getCurrentRewardEpochId()).toNumber();
  }

  async getCurrentPriceEpochId(): Promise<number> {
    return (await this.contracts.votingManager.getCurrentPriceEpochId()).toNumber();
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
