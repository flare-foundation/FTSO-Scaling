import BN from "bn.js";
import { Account, TransactionConfig, TransactionReceipt } from "web3-core";
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
import {
  getAccount,
  getFilteredBlock,
  isRevertError as isRevertTxError,
  isTransientTxError,
  loadContract,
  recoverSigner,
  signMessage,
} from "../web3-utils";
import { IVotingProvider } from "./IVotingProvider";
import { getLogger } from "../utils/logger";
import { promiseWithTimeout, retry, retryPredicate, retryWithTimeout } from "../utils/retry";
import { RevertedTxError, asError, errorString } from "../utils/error";
import { error } from "console";

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

  async claimRewards(claims: RewardClaimWithProof[]): Promise<any> {
    let nonce = await this.getNonce(this.claimAccount);
    for (const claim of claims) {
      this.logger.info(
        `Calling claim reward contract with ${claim}, using ${this.claimAccount.address}, nonce ${nonce}`
      );
      const methodCall = this.contracts.votingRewardManager.methods.claimReward(
        hexlifyBN(claim),
        this.votingAcccount.address
      );
      await this.signAndFinalize(
        "Claim reward",
        this.contracts.votingRewardManager.options.address,
        methodCall,
        0,
        this.claimAccount,
        nonce++
      );
    }
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

  private async getNonce(account: Account): Promise<number> {
    return await this.web3.eth.getTransactionCount(account.address);
  }

  private async signAndFinalize(
    label: string,
    toAddress: string,
    fnToEncode: NonPayableTransactionObject<void>,
    value: number | BN = 0,
    from: Account = this.votingAcccount,
    forceNonce?: number,
    gas: string = "2500000"
  ): Promise<TransactionReceipt> {
    let txNonce: number;

    const sendTx = async () => {
      txNonce = forceNonce ?? (await this.getNonce(from));
      const tx = <TransactionConfig>{
        from: from.address,
        to: toAddress,
        gas: gas,
        data: fnToEncode.encodeABI(),
        value: value,
        nonce: txNonce,
      };
      const signedTx = await from.signTransaction(tx);
      return this.web3.eth.sendSignedTransaction(signedTx.rawTransaction!);
    };

    const receiptOrError: Error | TransactionReceipt = await retryWithTimeout(async () => {
      try {
        return await sendTx();
      } catch (e: unknown) {
        const error = asError(e);
        this.logger.debug(`[${label}] Transaction failed: ${error.message}`);

        if (isRevertTxError(error)) {
          // Don't retry if transaction has been reverted, propagate error result.
          return this.getRevertReasonError(label, fnToEncode, from);
        } else if (isTransientTxError(error)) {
          // Retry on transient errors
          this.logger.debug(`[${label}] Transaction error, will retry: ${error.message}`);
          throw error;
        } else {
          // Don't retry, propagate unexpected errors.
          return new Error(`[${label}] Unexpected error sending tx`, { cause: error });
        }
      }
    }, 10_000);

    // TODO: What to do when max retries reached or sendTx keeps timing out?

    if (receiptOrError instanceof Error) throw receiptOrError as Error;

    const isTxFinalized = async () => (await this.getNonce(from)) > txNonce;
    await retryPredicate(isTxFinalized, 8, 1000);

    return receiptOrError as TransactionReceipt;
  }

  private async getRevertReasonError(
    label: string,
    fnToEncode: NonPayableTransactionObject<void>,
    from: Account
  ): Promise<Error> {
    try {
      // This call should throw a new exception containing the revert reason
      await fnToEncode.call({ from: from.address });
    } catch (e: unknown) {
      const error = asError(e);
      return new RevertedTxError(`[${label}] Transaction reverted`, error);
    }
    return new RevertedTxError(`[${label}] Transaction reverted, did not provide reason`);
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
