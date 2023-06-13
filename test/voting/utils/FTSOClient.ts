import fs from "fs";
import { Web3 } from "hardhat";
import { PriceOracleInstance, VoterRegistryInstance, VotingInstance, VotingManagerInstance, VotingRewardManagerInstance } from "../../../typechain-truffle";
import { toBN } from "../../utils/test-helpers";
import { MerkleTree } from "./MerkleTree";
import { PriceFeed, PriceFeedConfig } from "./PriceFeed";
import { BareSignature, ClaimReward, EpochData, EpochResult, MedianCalculationResult, RevealBitvoteData, SignatureData, TxData } from "./voting-interfaces";
import { hashClaimReward, sortedHashPair } from "./voting-utils";

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const EPOCH_BYTES = 8;

function padEndArray(array: any[], minLength: number, fillValue: any = undefined) {
  return Object.assign(new Array(minLength).fill(fillValue), array);
}

export class FTSOClient {
  firstEpochStartSec: number = 0;
  epochDurationSec: number = 0;

  startBlock: number = 0;
  lastProcessedBlockNumber: number = 0;
  voters: string[] = [];
  blockTimestamps = new Map<number, number>();
  epochCommits = new Map<number, Map<string, string>>()
  epochReveals = new Map<number, Map<string, RevealBitvoteData>>();
  epochSignatures = new Map<number, Map<string, SignatureData>>();
  epochData = new Map<number, EpochData>();
  epochResults = new Map<number, EpochResult>();
  web3!: Web3;
  commitABI: any;
  revealABI: any;
  signABI: any;

  commitFSig!: string;
  revealFSig!: string;
  signFSig!: string;
  votingRewardManagerContractAddress!: string;
  votingContractAddress!: string;
  voterRegistryContractAddress!: string;
  priceOracleContractAddress!: string;
  votingManagerContractAddress!: string;
  

  votingRewardManagerContract!: VotingRewardManagerInstance;
  votingContract!: VotingInstance;
  voterRegistryContract!: VoterRegistryInstance;
  priceOracleContract!: PriceOracleInstance;
  votingManagerContract!: VotingManagerInstance;


  elasticBandWidthPPM: number = 5000;

  startBlockNumber: number = 0;

  priceFeeds: PriceFeed[] = [];
  wallet: any;

  verbose: boolean = false;

  constructor(
    privateKey: string,
    votingRewardManagerContractAddress: string,
    priceOracleContractAddress: string,
    firstEpochStartSec: number,
    epochDurationSec: number
  ) {
    this.wallet = web3.eth.accounts.privateKeyToAccount(privateKey)
    this.votingRewardManagerContractAddress = votingRewardManagerContractAddress;
    this.priceOracleContractAddress = priceOracleContractAddress;
    this.firstEpochStartSec = firstEpochStartSec;
    this.epochDurationSec = epochDurationSec;
  }

  get senderAddress(): string {
    return this.wallet.address;
  }

  epochIdForTime(timestamp: number): number {
    return Math.floor((timestamp - this.firstEpochStartSec) / this.epochDurationSec);
  }

  revealEpochIdForTime(timestamp: number): number | undefined {
    let epochId = Math.floor((timestamp - this.firstEpochStartSec) / this.epochDurationSec);
    let revealDeadline = this.firstEpochStartSec + epochId * this.epochDurationSec + this.epochDurationSec / 2;
    if (timestamp > revealDeadline) {
      return undefined;
    }
    return epochId - 1;
  }

  async initialize(startBlockNumber: number, rpcLink?: string, providedWeb3?: Web3, logger?: any) {
    let votingAbiPath = "artifacts/contracts/voting/implementation/Voting.sol/Voting.json"
    // let voterRegistryAbiPath = "artifacts/contracts/voting/implementation/VoterRegistry.sol/VoterRegistry.json";
    let votingABI = JSON.parse(fs.readFileSync(votingAbiPath).toString()).abi as AbiItem[];

    // let voterRegistryABI = JSON.parse(fs.readFileSync(votingAbiPath).toString()).abi as AbiItem[];
    this.commitABI = votingABI.find((x: any) => x.name === "commit");
    this.revealABI = votingABI.find((x: any) => x.name === "revealBitvote");
    this.signABI = votingABI.find((x: any) => x.name === "signResult");

    this.startBlockNumber = startBlockNumber;
    this.lastProcessedBlockNumber = startBlockNumber - 1;

    this.initializeWeb3(rpcLink, providedWeb3, logger);

    // function signatures
    this.commitFSig = this.web3.eth.abi.encodeFunctionSignature(this.commitABI);
    this.revealFSig = this.web3.eth.abi.encodeFunctionSignature(this.revealABI);
    this.signFSig = this.web3.eth.abi.encodeFunctionSignature(this.signABI);

    // contracts
    let VotingRewardManager = artifacts.require("VotingRewardManager");
    let Voting = artifacts.require("Voting");
    let VoterRegistry = artifacts.require("VoterRegistry");
    let PriceOracle = artifacts.require("PriceOracle");
    let VotingManager = artifacts.require("VotingManager");

    this.votingRewardManagerContract = await VotingRewardManager.at(this.votingRewardManagerContractAddress);
    this.votingContractAddress = await this.votingRewardManagerContract.voting();
    this.votingContract = await Voting.at(this.votingContractAddress);
    this.voterRegistryContractAddress = await this.votingContract.voterRegistry();
    this.voterRegistryContract = await VoterRegistry.at(this.voterRegistryContractAddress);
    this.priceOracleContract = await PriceOracle.at(this.priceOracleContractAddress);
    this.votingManagerContract = await VotingManager.at(await this.votingContract.votingManager());
    // this.startProcessing();
  }

  private initializeWeb3(rpcLink?: string, providedWeb3?: Web3, logger?: any) {
    if (!rpcLink) {
      this.web3 = providedWeb3!;
      return;
    }
    const web3 = new Web3();
    if (rpcLink.startsWith("http")) {
      web3.setProvider(new Web3.providers.HttpProvider(rpcLink));
    } else if (rpcLink.startsWith("ws")) {
      const provider = new Web3.providers.WebsocketProvider(rpcLink, {
        // @ts-ignore
        clientConfig: {
          keepalive: true,
          keepaliveInterval: 60000, // milliseconds
        },
        reconnect: {
          auto: true,
          delay: 2500,
          onTimeout: true,
        },
      });
      provider.on("close", () => {
        if (logger) {
          logger.error(` ! Network WS connection closed.`);
        }
      });
      web3.setProvider(provider);
    }
    web3.eth.handleRevert = true;
    this.web3 = web3;
  }

  setVerbose(verbose: boolean) {
    this.verbose = verbose;
  }

  async processBlock(blockNumber: number) {
    let block = await web3.eth.getBlock(blockNumber, true);
    this.blockTimestamps.set(block.number, parseInt("" + block.timestamp));
    // let txPromises = [];
    // for (let txId of block.transactions) {
    //   txPromises.push(web3.eth.getTransaction(txId));
    // }
    // let result = await Promise.all(txPromises);
    for (let tx of block.transactions) {
      this.processTx(tx as any as TxData);
    }
    this.lastProcessedBlockNumber = blockNumber;
  }

  processTx(tx: TxData) {
    if (tx.to?.toLowerCase() === this.votingContractAddress.toLowerCase()) {
      let prefix = tx.input?.slice(0, 10);
      if (prefix && prefix.length === 10) {
        if (prefix === this.commitFSig) {
          return this.extractCommit(tx);
        } else if (prefix === this.revealFSig) {
          return this.extractReveal(tx);
        } else if (prefix === this.signFSig) {
          return this.extractSignature(tx);
        }
      }
    }
  }

  // commit(bytes32 _commitHash)
  private extractCommit(tx: TxData): void {
    let hash = this.web3.eth.abi.decodeParameters(this.commitABI.inputs, tx.input?.slice(10)!)?._commitHash;
    let from = tx.from.toLowerCase();
    let epochId = this.epochIdForTime(this.blockTimestamps.get(tx.blockNumber)!);
    let commitsInEpoch = this.epochCommits.get(epochId) || new Map<string, string>();
    this.epochCommits.set(epochId, commitsInEpoch);
    commitsInEpoch.set(from, hash);
  }

  // function revealBitvote(bytes32 _random, bytes32 _merkleRoot, bytes calldata _bitVote, bytes calldata _prices) 
  private extractReveal(tx: TxData): void {
    const resultTmp = this.web3.eth.abi.decodeParameters(this.revealABI.inputs, tx.input?.slice(10)!);
    const result = {
      random: resultTmp._random,
      merkleRoot: resultTmp._merkleRoot,
      bitVote: resultTmp._bitVote,
      prices: resultTmp._prices
    } as RevealBitvoteData;
    let from = tx.from.toLowerCase();
    let epochId = this.revealEpochIdForTime(this.blockTimestamps.get(tx.blockNumber)!);
    if (epochId !== undefined) {
      let revealsInEpoch = this.epochReveals.get(epochId) || new Map<string, RevealBitvoteData>();
      this.epochReveals.set(epochId, revealsInEpoch);
      revealsInEpoch.set(from, result);
    }
  }

  // function signResult(bytes32 _merkleRoot, Signature calldata signature)  
  private extractSignature(tx: TxData): void {

    const resultTmp = this.web3.eth.abi.decodeParameters(this.signABI.inputs, tx.input?.slice(10)!);
    const result = {
      epochId: parseInt(resultTmp._epochId, 10),
      merkleRoot: resultTmp._merkleRoot,
      v: parseInt(resultTmp.signature.v, 10),
      r: resultTmp.signature.r,
      s: resultTmp.signature.s
    } as SignatureData;
    let from = tx.from.toLowerCase();
    // let epochId = this.epochIdForTime(this.blockTimestamps.get(tx.blockNumber)!);
    let signaturesInEpoch = this.epochSignatures.get(result.epochId) || new Map<string, SignatureData>();
    this.epochSignatures.set(result.epochId, signaturesInEpoch);
    signaturesInEpoch.set(from, result);
  }

  async startProcessing() {
    let currentBlockNumber = await this.web3.eth.getBlockNumber();
    this.lastProcessedBlockNumber = currentBlockNumber - 1;
  }

  async processNewBlocks() {
    let currentBlockNumber = await this.web3.eth.getBlockNumber();
    while (this.lastProcessedBlockNumber < currentBlockNumber) {
      try {
        await this.processBlock(this.lastProcessedBlockNumber + 1);
        if (this.verbose) console.log("Processed block #" + this.lastProcessedBlockNumber);
      } catch (e) {
        console.error(e);
        return;
      }
    }
  }

  initializePriceFeeds(configs: PriceFeedConfig[]) {
    this.priceFeeds = configs.map(config => new PriceFeed(config));
  }

  scheduleActions() {
    // [END-]
    // preparePriceFeedsForEpoch(epochId: number)
    // onCommit(epochId: number)
    // [1 + 1/2-]
    // onReveal(epochId: number)
    // [1 + 1/2+]
    // calculateResults(epochId: number)
    // onSign(epochId: number)
  }

  async onCommit(epochId: number) {
    let epochData = this.epochData.get(epochId)
    if (!epochData) {
      throw new Error("Epoch data not found");
    }
    let hash = this.hashForCommit(this.senderAddress, epochData.random!, epochData.merkleRoot!, epochData.pricesHex!);
    await this.votingContract.commit(hash, { from: this.wallet.address });
  }

  async onReveal(epochId: number) {
    let epochData = this.epochData.get(epochId)
    if (!epochData) {
      throw new Error("Epoch data not found");
    }
    await this.votingContract.revealBitvote(epochData.random!, epochData.merkleRoot!, epochData.bitVote!, epochData.pricesHex!, { from: this.wallet.address });
  }

  async onSign(epochId: number, skipCalculation = false) {
    if (!skipCalculation) {
      await this.calculateResults(epochId);
    }
    let result = this.epochResults.get(epochId);
    if (!result) {
      throw new Error("Result not found");
    }

    // const message = this.messageForSign(epochId);
    // let messageHash = this.web3.utils.soliditySha3(message);
    let signature = await this.wallet.sign(result.merkleRoot);
    await this.votingContract.signResult(epochId,
      result.merkleRoot!,
      {
        v: signature.v,
        r: signature.r,
        s: signature.s
      }, { from: this.wallet.address });
  }

  // Encoding of signed result
  // [4 epochId][32-byte merkle root][4-byte price sequence]

  private calculateRevealers(epochId: number) {
    let commits = this.epochCommits.get(epochId);
    let reveals = this.epochReveals.get(epochId);
    if (!commits || !reveals) {
      return [];
    }
    let senders = [...commits.keys()];
    return senders.filter(sender => {
      let revealData = reveals!.get(sender);
      if (!revealData) {
        return false;
      }
      let commitHash = this.epochCommits.get(epochId)?.get(sender);
      return commitHash === this.hashForCommit(sender, revealData.random, revealData.merkleRoot, revealData.prices);
    });
  }

  // not used
  private async getWeightsForEpoch(epochId: number, senders: string[]) {
    return this.votingContract.getVoterWeightsForEpoch(epochId, senders);
  }

  async calculateResults(epochId: number) {
    let voters = this.calculateRevealers(epochId)!;
    if (voters.length === 0) {
      return;
    }
    let rewardEpochId: BN = await this.votingManagerContract.getRewardEpochIdForEpoch(epochId);
    let numberOfFeeds = (await this.priceOracleContract.numberOfFeedsPerRewardEpoch(rewardEpochId)).toNumber();

    // let weights = this.getWeightsForEpoch(epochId, voters);
    let pricesForVoters = voters.map(voter => {
      let revealData = this.epochReveals.get(epochId)!.get(voter)!;
      let feeds = revealData.prices.slice(2).match(/(.{1,8})/g)?.map(hex => parseInt(hex, 16)) || [];
      feeds = feeds.slice(0, numberOfFeeds);
      return padEndArray(feeds, numberOfFeeds, 0);
    });

    let results: MedianCalculationResult[] = [];
    for (let i = 0; i < numberOfFeeds; i++) {
      let prices = pricesForVoters.map(allPrices => allPrices[i]);
      // TODO: call TS median function
      // let data = await this.ftsoCalculatorContract.calculateMedian(epochId, voters, prices, this.elasticBandWidthPPM) as unknown as MedianCalculationResult;
      // augment data with voter addresses in the same order
      data.voters = voters;
      data.prices = prices;
      results.push(data);
    }
    
    let rewardedSenders = [...this.epochCommits.get(epochId)!.keys()];
    // Fake choice of senders to receive rewards
    rewardedSenders = rewardedSenders.slice(0, rewardedSenders.length / 2);
    // Fake computation of rewards
    let rewards = new Map(rewardedSenders.map((sender) => 
      [sender,
        {
          merkleProof: [],
          amount: toBN(100),
          poolId: "0x000000000000000000000000000000f1a4e00000000000000000000000000000",
          voterAddress: sender,
          chainId: 0,
          epochId,
          tokenContract: "0x0000000000000000000000000000000000000000"
        } as ClaimReward
      ]
    ))
    let clientRewardHash: string | null = null;
    let rewardClaimHashes = [...rewards.values()].map((value) => {
      let hash = hashClaimReward(value);
      if (value.voterAddress == this.wallet.address) { clientRewardHash = hash; }
      return hash;
    });
    let dataMerkleTree = new MerkleTree(rewardClaimHashes);
    let dataMerkleRoot = dataMerkleTree.root!;

    let priceMessage = ""
    results.map(data => {
      priceMessage += Web3.utils.padLeft(parseInt(data.data.finalMedianPrice, 10).toString(16), 8);
    });

    let message = Web3.utils.padLeft(epochId.toString(16), EPOCH_BYTES * 2) + priceMessage;

    let priceMessageHash = this.web3.utils.soliditySha3("0x" + message)!;
    let merkleRoot = sortedHashPair(priceMessageHash, dataMerkleRoot);
    this.epochResults.set(epochId, {
      epochId,
      medianData: results,
      priceMessage: "0x" + priceMessage,
      fullPriceMessage: "0x" + message,
      fullMessage: dataMerkleRoot + message,
      dataMerkleRoot,
      dataMerkleProof: dataMerkleTree.getProof(clientRewardHash),
      rewards,
      merkleRoot
    } as EpochResult);
  }

  preparePriceFeedsForEpoch(epochId: number) {
    let data = this.epochData.get(epochId) || { epochId };
    this.epochData.set(epochId, data);
    data.merkleRoot = ZERO_BYTES32;
    data.prices = this.priceFeeds.map(priceFeed => priceFeed.getPriceForEpoch(epochId));
    data.pricesHex = this.packPrices(data.prices);
    data.random = Web3.utils.randomHex(32);
    data.bitVote = "0x00";
  }

  packPrices(prices: (number | string)[]) {
    return "0x" + prices.map(price => parseInt("" + price).toString(16).padStart(8, "0")).join("");
  }

  hashForCommit(voter: string, random: string, merkleRoot: string, prices: string) {
    const types = [
      "address",
      "uint256",
      "bytes32",
      "bytes"
    ];
    const values = [
      voter,
      random,
      merkleRoot,
      prices
    ] as any[];
    const encoded = web3.eth.abi.encodeParameters(types, values);
    return web3.utils.soliditySha3(encoded)!;
  }

  async onSendSignaturesForMyMerkleRoot(epochId: number) {
    let signaturesTmp = [...this.epochSignatures.get(epochId)!.values()];
    let mySignatureHash = this.epochResults.get(epochId)!.merkleRoot!;
    let signatures = signaturesTmp
      .filter(sig => sig.merkleRoot === mySignatureHash)
      .map(sig => {
        return {
          v: sig.v,
          r: sig.r,
          s: sig.s
        } as BareSignature
      })
    return await this.votingContract.finalize(epochId, mySignatureHash, signatures, { from: this.wallet.address });
  }

  async publishPriceFeeds(epochId: number) {
    let result = this.epochResults.get(epochId);
    if(!result) {
      throw new Error("Result not found");
    }
    // console.log(result.dataMerkleRoot, result.fullPriceMessage, result.merkleRoot)
    return await this.priceOracleContract.publishPrices(result.dataMerkleRoot, result.fullPriceMessage, { from: this.wallet.address });
  }

  async claimReward(epochId: number) {
    let result = this.epochResults.get(epochId)!;
    let rewardClaim = result.rewards.get(this.wallet.address);
    let proof = result.dataMerkleProof;
    if (rewardClaim && proof) { 
      rewardClaim.merkleProof = proof; 
      return this.votingRewardManagerContract.claimReward(rewardClaim);
    }
    else {
      return null;
    }
  }
}