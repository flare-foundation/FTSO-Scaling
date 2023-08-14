import BN from "bn.js";
import { Account, TransactionConfig } from "web3-core";
import { AbiItem } from "web3-utils";
import { ContractAddresses } from "../../deployment/tasks/common";

import { readFileSync } from "fs";
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
import { getAccount, getContractAbis, loadContract } from "../web3-utils";
import { IVotingProvider } from "./IVotingProvider";

interface TypeChainContracts {
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
  private account: Account;

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
    privateKey: string
  ) {
    this.account = getAccount(web3, privateKey);
    [this.functionSignatures, this.eventSignatures, this.abis] = getContractAbis(web3);
  }

  async claimReward(claim: ClaimReward): Promise<any> {
    const claimReward = deepCopyClaim(claim);
    delete claimReward.hash;
    const methodCall = this.contracts.votingRewardManager.methods.claimReward(
      hexlifyBN(claimReward),
      this.account.address
    );
    return await this.signAndFinalize("Claim reward", this.contracts.votingRewardManager.options.address, methodCall);
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
      epochData.random!,
      epochData.merkleRoot!,
      epochData.bitVote!,
      epochData.pricesHex!
    );
    return await this.signAndFinalize("Reveal", this.contracts.voting.options.address, methodCall);
  }

  async signResult(epochId: number, merkleRoot: string, signature: BareSignature): Promise<any> {
    const methodCall = this.contracts.voting.methods.signResult(epochId, merkleRoot, [
      signature.v,
      signature.r,
      signature.s,
    ]);
    return await this.signAndFinalize("Sign result", this.contracts.voting.options.address, methodCall);
  }

  async finalize(epochId: number, mySignatureHash: string, signatures: BareSignature[]) {
    const methodCall = this.contracts.voting.methods.finalize(
      epochId,
      mySignatureHash,
      signatures.map(s => [s.v, s.r, s.s])
    );
    return await this.signAndFinalize("Finalize", this.contracts.voting.options.address, methodCall);
  }

  async publishPrices(epochResult: EpochResult, symbolIndices: number[]): Promise<any> {
    const methodCall = this.contracts.priceOracle.methods.publishPrices(
      epochResult.dataMerkleRoot,
      epochResult.priceEpochId,
      epochResult.priceMessage,
      epochResult.symbolMessage,
      symbolIndices
    );
    return await this.signAndFinalize("Finalize", this.contracts.priceOracle.options.address, methodCall);
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
    return this.account.address.toLowerCase();
  }

  async getCurrentRewardEpochId(): Promise<number> {
    return +(await this.contracts.votingManager.methods.getCurrentRewardEpochId().call());
  }

  async getCurrentPriceEpochId(): Promise<number> {
    return +(await this.contracts.votingManager.methods.getCurrentPriceEpochId().call());
  }

  private decodeFunctionCall(tx: TxData, name: string) {
    const encodedParameters = tx.input!.slice(10); // Drop the function signature
    const parametersEncodingABI = this.abis.get(name)!.inputs;
    return this.web3.eth.abi.decodeParameters(parametersEncodingABI, encodedParameters);
  }

  private async signAndFinalize(
    label: string,
    toAddress: string,
    fnToEncode: NonPayableTransactionObject<void>,
    value: number | BN = 0,
    gas: string = "2500000"
  ): Promise<boolean> {
    const nonce = await this.web3.eth.getTransactionCount(this.account.address);
    const tx = <TransactionConfig>{
      from: this.account.address,
      to: toAddress,
      gas: gas,
      gasPrice: this.config.gasPrice,
      data: fnToEncode.encodeABI(),
      value: value,
      nonce: nonce,
    };
    const signedTx = await this.account.signTransaction(tx);

    try {
      await this.waitFinalize(this.account.address, () =>
        this.web3.eth.sendSignedTransaction(signedTx.rawTransaction!)
      );
      return true;
    } catch (e: any) {
      if (e.message.indexOf("Transaction has been reverted by the EVM") < 0) {
        console.log(`${label} | Nonce sent: ${nonce} | signAndFinalize3 error: ${e.message}`);
      } else {
        fnToEncode
          .call({ from: this.account.address })
          .then((result: any) => {
            throw Error("unlikely to happen: " + JSON.stringify(result));
          })
          .catch((revertReason: any) => {
            console.log(`${label} | Nonce sent: ${nonce} | signAndFinalize3 error: ${revertReason}`);
          });
      }
      return false;
    }
  }

  private async waitFinalize(address: string, func: () => any, delay: number = 1000) {
    const nonce = await this.web3.eth.getTransactionCount(address);
    const res = await func();
    const backoff = 1.5;
    let retries = 0;
    while ((await this.web3.eth.getTransactionCount(address)) == nonce) {
      await sleepFor(delay);
      if (retries < 8) {
        delay = Math.floor(delay * backoff);
        retries++;
      } else {
        throw new Error("Response timeout");
      }
      console.log(`Delay backoff ${delay} (${retries})`);
    }
    return res;
  }

  static async create(contractAddresses: ContractAddresses, web3: Web3, config: FTSOParameters, privateKey: string) {
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

    return new Web3Provider(
      contractAddresses,
      firstEpochStartSec,
      epochDurationSec,
      firstRewardedPriceEpoch,
      rewardEpochDurationInEpochs,
      signingDurationSec,
      web3,
      contracts,
      config,
      privateKey
    );
  }
}
