import BN from "bn.js";
import { Account, TransactionConfig } from "web3-core";
import { ContractAddresses } from "../../deployment/tasks/common";

import Web3 from "web3";
import { FTSOParameters } from "../../deployment/config/FTSOParameters";
import {
  PriceOracle,
  VoterRegistry,
  Voting,
  VotingManager,
  VotingRewardManager,
} from "../../typechain-web3/contracts/voting/implementation";
import { NonPayableTransactionObject } from "../../typechain-web3/types";
import { sleepFor } from "../time-utils";
import {
  BareSignature,
  BlockData,
  RewardClaimWithProof,
  EpochData,
  EpochResult,
  Offer,
  VoterWithWeight,
} from "../voting-interfaces";
import { ZERO_ADDRESS, hexlifyBN, toBN } from "../voting-utils";
import { getAccount, getFilteredBlock, loadContract, recoverSigner, signMessage } from "../web3-utils";
import { IVotingProvider } from "./IVotingProvider";
import { getLogger } from "../utils/logger";

const FORCE_NONCE_RESET_ON = 3;

interface TypeChainContracts {
  readonly votingRewardManager: VotingRewardManager;
  readonly voting: Voting;
  readonly voterRegistry: VoterRegistry;
  readonly priceOracle: PriceOracle;
  readonly votingManager: VotingManager;
}

export class Web3Provider implements IVotingProvider {
  private readonly logger = getLogger(Web3Provider.name);
  private readonly votingAcccount: Account;
  private readonly claimAccount: Account;

  private localNonce: number | undefined;
  private nonceResetCount: number = FORCE_NONCE_RESET_ON;

  private constructor(
    readonly contractAddresses: ContractAddresses,
    readonly firstEpochStartSec: number,
    readonly epochDurationSec: number,
    readonly firstRewardedPriceEpoch: number,
    readonly rewardEpochDurationInEpochs: number,
    readonly signingDurationSec: number,
    readonly web3: Web3,
    private contracts: TypeChainContracts,
    private config: FTSOParameters,
    votingKey: string,
    claimKey: string
  ) {
    this.votingAcccount = getAccount(web3, votingKey);
    this.claimAccount = getAccount(web3, claimKey);
  }

  async thresholdForRewardEpoch(rewardEpochId: number): Promise<BN> {
    const threshold = await this.contracts.voterRegistry.methods.thresholdForRewardEpoch(rewardEpochId).call();
    return toBN(threshold);
  }

  /**
   * Authorizes the provided claimer account to process reward claims for the voter.
   * Note: the voter account will still be the beneficiary of the reward value.
   */
  private async authorizeClaimer(claimerAddress: string): Promise<any> {
    const methodCall = this.contracts.votingRewardManager.methods.authorizeClaimer(claimerAddress);
    return await this.signAndFinalize(
      "Authorize claimer",
      this.contracts.votingRewardManager.options.address,
      methodCall
    );
  }

  async claimReward(claim: RewardClaimWithProof): Promise<any> {
    this.logger.info(`Calling claim reward contract with claim ${claim}, using ${this.claimAccount.address}`);
    const methodCall = this.contracts.votingRewardManager.methods.claimReward(
      hexlifyBN(claim),
      this.votingAcccount.address
    );
    return await this.signAndFinalize(
      "Claim reward",
      this.contracts.votingRewardManager.options.address,
      methodCall,
      0,
      this.claimAccount
    );
  }

  async offerRewards(offers: Offer[]): Promise<any> {
    let totalAmount = toBN(0);
    offers.forEach(offer => {
      if (offer.currencyAddress === ZERO_ADDRESS) {
        totalAmount = totalAmount.add(offer.amount);
      }
    });

    const methodCall = this.contracts.votingRewardManager.methods.offerRewards(hexlifyBN(offers));
    return await this.signAndFinalize(
      "Offer rewards",
      this.contracts.votingRewardManager.options.address,
      methodCall,
      totalAmount
    );
  }

  async commit(hash: string): Promise<any> {
    const methodCall = this.contracts.voting.methods.commit(hash);
    return await this.signAndFinalize("Commit", this.contracts.voting.options.address, methodCall);
  }

  async revealBitvote(epochData: EpochData): Promise<any> {
    const methodCall = this.contracts.voting.methods.revealBitvote(
      epochData.random.value,
      epochData.merkleRoot,
      epochData.bitVote,
      epochData.pricesHex
    );
    return await this.signAndFinalize("Reveal", this.contracts.voting.options.address, methodCall);
  }

  async signResult(priceEpochId: number, merkleRoot: string, signature: BareSignature): Promise<any> {
    const methodCall = this.contracts.voting.methods.signResult(priceEpochId, merkleRoot, [
      signature.v,
      signature.r,
      signature.s,
    ]);
    return await this.signAndFinalize("Sign result", this.contracts.voting.options.address, methodCall);
  }

  async finalize(priceEpochId: number, mySignatureHash: string, signatures: BareSignature[]): Promise<any> {
    const methodCall = this.contracts.voting.methods.finalize(
      priceEpochId,
      mySignatureHash,
      signatures.map(s => [s.v, s.r, s.s])
    );
    return await this.signAndFinalize("Finalize", this.contracts.voting.options.address, methodCall);
  }

  async getMerkleRoot(priceEpochId: number): Promise<string> {
    return await this.contracts.voting.methods.getMerkleRootForPriceEpoch(priceEpochId).call();
  }

  async publishPrices(epochResult: EpochResult, symbolIndices: number[]): Promise<any> {
    const methodCall = this.contracts.priceOracle.methods.publishPrices(
      epochResult.rewardClaimMerkleRoot,
      epochResult.priceEpochId,
      epochResult.priceMessage,
      epochResult.symbolMessage,
      epochResult.randomMessage,
      symbolIndices
    );
    return await this.signAndFinalize("Publish prices", this.contracts.priceOracle.options.address, methodCall);
  }

  async signMessage(message: string): Promise<BareSignature> {
    const signature = signMessage(this.web3, message, this.votingAcccount.privateKey);
    return Promise.resolve(signature);
  }

  async recoverSigner(message: string, signature: BareSignature): Promise<string> {
    const signer = recoverSigner(this.web3, message, signature);
    return Promise.resolve(signer);
  }

  async allVotersWithWeightsForRewardEpoch(rewardEpoch: number): Promise<VoterWithWeight[]> {
    const data = await this.contracts.voterRegistry.methods.votersForRewardEpoch(rewardEpoch).call();
    const voters = data[0];
    const weights = data[1].map(w => toBN(w));
    const result: VoterWithWeight[] = [];
    for (let i = 0; i < voters.length; i++) {
      result.push({ voterAddress: voters[i], weight: weights[i], originalWeight: weights[i] });
    }
    return result;
  }

  async registerAsVoter(rewardEpochId: number, weight: number): Promise<any> {
    const methodCall = this.contracts.voterRegistry.methods.registerAsAVoter(rewardEpochId, weight);
    return await this.signAndFinalize("Register as voter", this.contracts.voterRegistry.options.address, methodCall);
  }

  async getBlockNumber(): Promise<number> {
    return this.web3.eth.getBlockNumber();
  }

  async getBlock(blockNumber: number): Promise<BlockData> {
    return await getFilteredBlock(this.web3, blockNumber, [
      this.contractAddresses.voting,
      this.contractAddresses.votingRewardManager,
    ]);
  }

  get senderAddressLowercase(): string {
    return this.votingAcccount.address.toLowerCase();
  }

  async getCurrentRewardEpochId(): Promise<number> {
    return +(await this.contracts.votingManager.methods.getCurrentRewardEpochId().call());
  }

  async getCurrentPriceEpochId(): Promise<number> {
    return +(await this.contracts.votingManager.methods.getCurrentPriceEpochId().call());
  }

  private async signAndFinalize(
    label: string,
    toAddress: string,
    fnToEncode: NonPayableTransactionObject<void>,
    value: number | BN = 0,
    from: Account = this.votingAcccount,
    gas: string = "2500000"
  ): Promise<void> {
    const nonce = await this.web3.eth.getTransactionCount(from.address)
    const tx = <TransactionConfig>{
      from: this.votingAcccount.address,
      to: toAddress,
      gas: gas,
      data: fnToEncode.encodeABI(),
      value: value,
      nonce: nonce,
    };
    const signedTx = await from.signTransaction(tx);
    try {
      await this.waitFinalize(from.address, nonce, () => this.web3.eth.sendSignedTransaction(signedTx.rawTransaction!));
    } catch (e) {
      if (e instanceof Error && e.message.indexOf("Transaction has been reverted by the EVM") >= 0) {
        this.logger.debug(`[${label}] Transaction failed: ${e.message}`);
        // This call should throw a new exception containing the revert reason
        await fnToEncode.call({ from: from.address });
      }
      // Otherwise, either revert reason was already part of the original error or
      // we failed to get any additional information.
      throw e;
    }
  }

  /**
   * We keep track of the transction nonce locally to be able to submit more than one transaction for the same block.
   * The nonce is reloaded from the network after every {@link FORCE_NONCE_RESET_ON} uses to make sure we don't get out of sync.
   */
  private async getNonce(): Promise<number> {
    this.nonceResetCount--;
    if (this.localNonce && this.nonceResetCount > 0) {
      this.localNonce++;
    } else {
      this.localNonce = await this.web3.eth.getTransactionCount(this.votingAcccount.address);
      this.nonceResetCount = FORCE_NONCE_RESET_ON;
    }
    return this.localNonce;
  }

  private async waitFinalize<T>(
    address: string,
    nonce: number,
    func: () => Promise<T>,
    delay: number = 1000
  ): Promise<T> {
    const res = await func();
    const backoff = 1.5;
    let retries = 0;
    while ((await this.web3.eth.getTransactionCount(address)) <= nonce) {
      await sleepFor(delay);
      if (retries < 8) {
        delay = Math.floor(delay * backoff);
        retries++;
      } else {
        throw new Error("Response timeout");
      }
      this.logger.info(`Delay backoff ${delay} (${retries})`);
    }
    return res;
  }

  static async create(
    contractAddresses: ContractAddresses,
    web3: Web3,
    config: FTSOParameters,
    votingKey: string,
    claimKey: string
  ) {
    const contracts = {
      votingRewardManager: await loadContract<VotingRewardManager>(
        web3,
        contractAddresses.votingRewardManager,
        "VotingRewardManager"
      ),
      voting: await loadContract<Voting>(web3, contractAddresses.voting, "Voting"),
      voterRegistry: await loadContract<VoterRegistry>(web3, contractAddresses.voterRegistry, "VoterRegistry"),
      priceOracle: await loadContract<PriceOracle>(web3, contractAddresses.priceOracle, "PriceOracle"),
      votingManager: await loadContract<VotingManager>(web3, contractAddresses.votingManager, "VotingManager"),
    };

    const firstEpochStartSec = +(await contracts.votingManager.methods.BUFFER_TIMESTAMP_OFFSET().call());
    const epochDurationSec = +(await contracts.votingManager.methods.BUFFER_WINDOW().call());
    const firstRewardedPriceEpoch = +(await contracts.votingManager.methods.firstRewardedPriceEpoch().call());
    const rewardEpochDurationInEpochs = +(await contracts.votingManager.methods.rewardEpochDurationInEpochs().call());
    const signingDurationSec = +(await contracts.votingManager.methods.signingDurationSec().call());

    const provider = new Web3Provider(
      contractAddresses,
      firstEpochStartSec,
      epochDurationSec,
      firstRewardedPriceEpoch,
      rewardEpochDurationInEpochs,
      signingDurationSec,
      web3,
      contracts,
      config,
      votingKey,
      claimKey
    );

    if (votingKey != claimKey) {
      await provider.authorizeClaimer(provider.claimAccount.address);
    }
    return provider;
  }
}
