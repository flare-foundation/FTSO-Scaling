import { Web3 } from "hardhat";
import { toBN } from "../test-utils/utils/test-helpers";
import { MerkleTree } from "./MerkleTree";
import { PriceFeed, PriceFeedConfig } from "./PriceFeed";
import { calculateMedian } from "./median-calculation-utils";
import { IVotingProvider } from "./providers/IVotingProvider";
import { BareSignature, ClaimReward, ClaimRewardBody, EpochData, EpochResult, Feed, MedianCalculationResult, Offer, RevealBitvoteData, SignatureData, TxData } from "./voting-interfaces";
import { feedId, hashClaimReward, sortedHashPair } from "./voting-utils";

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const EPOCH_BYTES = 8;

function padEndArray(array: any[], minLength: number, fillValue: any = undefined) {
  return Object.assign(new Array(minLength).fill(fillValue), array);
}

export class FTSOClient {
  provider: IVotingProvider;

  startBlock: number = 0;
  lastProcessedBlockNumber: number = 0;
  voters: string[] = [];
  blockTimestamps = new Map<number, number>();
  priceEpochCommits = new Map<number, Map<string, string>>()
  priceEpochReveals = new Map<number, Map<string, RevealBitvoteData>>();
  priceEpochSignatures = new Map<number, Map<string, SignatureData>>();
  priceEpochData = new Map<number, EpochData>();
  priceEpochResults = new Map<number, EpochResult>();
  // rewardEpoch => feeId => offers
  rewardEpochOffers = new Map<number, Map<string, Offer[]>>();

  elasticBandWidthPPM: number = 5000;

  startBlockNumber: number = 0;

  priceFeeds: PriceFeed[] = [];
  wallet: any;

  verbose: boolean = false;

  constructor(
    privateKey: string,
    provider: IVotingProvider,
  ) {
    this.wallet = web3.eth.accounts.privateKeyToAccount(privateKey);
    this.provider = provider;
  }

  get senderAddress(): string {
    return this.wallet.address;
  }

  epochIdForTime(timestamp: number): number {
    return Math.floor((timestamp - this.provider.firstEpochStartSec) / this.provider.epochDurationSec);
  }

  revealEpochIdForTime(timestamp: number): number | undefined {
    let epochId = Math.floor((timestamp - this.provider.firstEpochStartSec) / this.provider.epochDurationSec);
    let revealDeadline = this.provider.firstEpochStartSec + epochId * this.provider.epochDurationSec + this.provider.epochDurationSec / 2;
    if (timestamp > revealDeadline) {
      return undefined;
    }
    return epochId - 1;
  }

  rewardEpochIdForPriceEpochId(priceEpochId: number): number {
    if (priceEpochId < this.provider.firstRewardedPriceEpoch) {
      throw new Error("Price epoch is too low");
    }
    return Math.floor((priceEpochId - this.provider.firstRewardedPriceEpoch) / this.provider.rewardEpochDurationInEpochs);
  }

  async initialize(startBlockNumber: number, rpcLink?: string, providedWeb3?: Web3, logger?: any) {
    this.startBlockNumber = startBlockNumber;
    this.lastProcessedBlockNumber = startBlockNumber - 1;

    // this.initializeWeb3(rpcLink, providedWeb3, logger);
  }

  // private initializeWeb3(rpcLink?: string, providedWeb3?: Web3, logger?: any) {
  //   if (!rpcLink) {
  //     this.web3 = providedWeb3!;
  //     return;
  //   }
  //   const web3 = new Web3();
  //   if (rpcLink.startsWith("http")) {
  //     web3.setProvider(new Web3.providers.HttpProvider(rpcLink));
  //   } else if (rpcLink.startsWith("ws")) {
  //     const provider = new Web3.providers.WebsocketProvider(rpcLink, {
  //       // @ts-ignore
  //       clientConfig: {
  //         keepalive: true,
  //         keepaliveInterval: 60000, // milliseconds
  //       },
  //       reconnect: {
  //         auto: true,
  //         delay: 2500,
  //         onTimeout: true,
  //       },
  //     });
  //     provider.on("close", () => {
  //       if (logger) {
  //         logger.error(` ! Network WS connection closed.`);
  //       }
  //     });
  //     web3.setProvider(provider);
  //   }
  //   web3.eth.handleRevert = true;
  //   this.web3 = web3;
  // }

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
    let prefix = tx.input?.slice(0, 10);
    if (tx.to?.toLowerCase() === this.provider.votingContractAddress.toLowerCase()) {
      if (prefix && prefix.length === 10) {
        if (prefix === this.provider.functionSignature("commit")) {
          return this.extractCommit(tx);
        } else if (prefix === this.provider.functionSignature("revealBitvote")) {
          return this.extractReveal(tx);
        } else if (prefix === this.provider.functionSignature("signResult")) {
          return this.extractSignature(tx);
        }
      }
    } else
      if (tx.to?.toLowerCase() === this.provider.votingRewardManagerContractAddress.toLowerCase()) {
        if (prefix === this.provider.functionSignature("offerRewards")) {
          return this.extractOffers(tx);
        }
      }
  }

  /**
   * Extract offers from transaction input.
   * Assumption: the transaction is a call to `offerRewards` function.
   * @param tx 
   */
  private extractOffers(tx: TxData): void {
    let offers: Offer[] = this.provider.extractOffers(tx);
    let rewardEpochId = this.rewardEpochIdForPriceEpochId(this.epochIdForTime(this.blockTimestamps.get(tx.blockNumber)!));

    let offersInEpoch = this.rewardEpochOffers.get(rewardEpochId) ?? new Map<string, Offer[]>();
    this.rewardEpochOffers.set(rewardEpochId, offersInEpoch)

    for (let offer of offers) {
      let offersForFeed = offersInEpoch.get(feedId(offer)) ?? [];
      offersInEpoch.set(feedId(offer), offersForFeed);
      offersForFeed.push(offer);      
    }
  }

  // commit(bytes32 _commitHash)
  private extractCommit(tx: TxData): void {
    let hash = this.provider.extractCommitHash(tx);
    let from = tx.from.toLowerCase();
    let epochId = this.epochIdForTime(this.blockTimestamps.get(tx.blockNumber)!);
    let commitsInEpoch = this.priceEpochCommits.get(epochId) || new Map<string, string>();
    this.priceEpochCommits.set(epochId, commitsInEpoch);
    commitsInEpoch.set(from.toLowerCase(), hash);
  }

  // function revealBitvote(bytes32 _random, bytes32 _merkleRoot, bytes calldata _bitVote, bytes calldata _prices) 
  private extractReveal(tx: TxData): void {
    const result = this.provider.extractRevealBitvoteData(tx);
    let from = tx.from.toLowerCase();
    let epochId = this.revealEpochIdForTime(this.blockTimestamps.get(tx.blockNumber)!);
    if (epochId !== undefined) {
      let revealsInEpoch = this.priceEpochReveals.get(epochId) || new Map<string, RevealBitvoteData>();
      this.priceEpochReveals.set(epochId, revealsInEpoch);
      revealsInEpoch.set(from.toLowerCase(), result);
    }
  }

  // function signResult(bytes32 _merkleRoot, Signature calldata signature)  
  private extractSignature(tx: TxData): void {
    let result = this.provider.extractSignatureData(tx);
    let from = tx.from.toLowerCase();
    // let epochId = this.epochIdForTime(this.blockTimestamps.get(tx.blockNumber)!);
    let signaturesInEpoch = this.priceEpochSignatures.get(result.epochId) || new Map<string, SignatureData>();
    this.priceEpochSignatures.set(result.epochId, signaturesInEpoch);
    signaturesInEpoch.set(from.toLowerCase(), result);
  }

  async startProcessing() {
    let currentBlockNumber = await this.provider.getBlockNumber();
    this.lastProcessedBlockNumber = currentBlockNumber - 1;
  }

  async processNewBlocks() {
    let currentBlockNumber = await this.provider.getBlockNumber();
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
    let epochData = this.priceEpochData.get(epochId)
    if (!epochData) {
      throw new Error("Epoch data not found");
    }
    let hash = this.hashForCommit(this.senderAddress, epochData.random!, epochData.merkleRoot!, epochData.pricesHex!);
    await this.provider.commit(hash, this.wallet.address);
  }

  async onReveal(epochId: number) {
    let epochData = this.priceEpochData.get(epochId)
    if (!epochData) {
      throw new Error("Epoch data not found");
    }
    await this.provider.revealBitvote(epochData, this.wallet.address);
  }

  async onSign(epochId: number, symbolSequence: Feed[], skipCalculation = false) {
    if (!skipCalculation) {
      await this.calculateResults(epochId, symbolSequence);
    }
    let result = this.priceEpochResults.get(epochId);
    if (!result) {
      throw new Error("Result not found");
    }

    // const message = this.messageForSign(epochId);
    // let messageHash = this.web3.utils.soliditySha3(message);
    let signature = await this.wallet.sign(result.merkleRoot);
    await this.provider.signResult(epochId,
      result.merkleRoot!,
      {
        v: signature.v,
        r: signature.r,
        s: signature.s
      },
      this.wallet.address
    );
  }

  // Encoding of signed result
  // [4 epochId][32-byte merkle root][4-byte price sequence]

  private calculateRevealers(epochId: number) {
    let commits = this.priceEpochCommits.get(epochId);
    let reveals = this.priceEpochReveals.get(epochId);
    if (!commits || !reveals) {
      return [];
    }
    let senders = [...commits.keys()];
    return senders.filter(sender => {
      let revealData = reveals!.get(sender.toLowerCase());
      if (!revealData) {
        return false;
      }
      let commitHash = this.priceEpochCommits.get(epochId)?.get(sender.toLowerCase());
      return commitHash === this.hashForCommit(sender, revealData.random, revealData.merkleRoot, revealData.prices);
    });
  }

  /**
   * 
   * @param priceEpochId 
   * @param symbolMap 
   * @returns 
   */
  async calculateResults(priceEpochId: number, symbolSequence: Feed[]) {
    const symbolMap = new Map<number, Feed>();
    let rewardEpoch = this.rewardEpochIdForPriceEpochId(priceEpochId);
    for (let i = 0; i < symbolSequence.length; i++) {
      symbolMap.set(i, symbolSequence[i]);
    }
    let voters = this.calculateRevealers(priceEpochId)!;
    if (voters.length === 0) {
      return;
    }
    let numberOfFeeds = symbolSequence.length;
    // TODO: do this only once per reward epoch
    let weights = await this.provider.voterWeightsInRewardEpoch(rewardEpoch, voters);
    let pricesForVoters = voters.map(voter => {
      let revealData = this.priceEpochReveals.get(priceEpochId)!.get(voter.toLowerCase())!;
      let feeds = revealData.prices.slice(2).match(/(.{1,8})/g)?.map(hex => parseInt(hex, 16)) || [];
      feeds = feeds.slice(0, numberOfFeeds);
      return padEndArray(feeds, numberOfFeeds, 0);
    });

    let results: MedianCalculationResult[] = [];
    for (let i = 0; i < numberOfFeeds; i++) {
      let prices = pricesForVoters.map(allPrices => toBN(allPrices[i]));
      let data = calculateMedian(voters, prices, weights, this.elasticBandWidthPPM);
      results.push({
        symbol: symbolMap.get(i)!,
        voters: voters,
        prices: prices.map(price => price.toNumber()),
        data: data,
        weights: weights
      } as MedianCalculationResult);
    }

    let rewardedSenders = [...this.priceEpochCommits.get(priceEpochId)!.keys()];
    // Fake choice of senders to receive rewards
    rewardedSenders = rewardedSenders.slice(0, rewardedSenders.length / 2);
    // Fake computation of rewards
    let rewards = new Map(rewardedSenders.map((sender) =>
      [sender,
        {
          merkleProof: [],
          claimRewardBody: {
            amount: toBN(100),
            currencyAddress: "0x0000000000000000000000000000000000000000",
            voterAddress: sender,
            epochId: priceEpochId,
          } as ClaimRewardBody
        } as ClaimReward
      ]
    ))
    let clientRewardHash: string | null = null;
    let rewardClaimHashes = [...rewards.values()].map((value) => {
      let hash = hashClaimReward(value, this.provider.abiForName.get("claimRewardBodyDefinition")!);
      if (value.claimRewardBody.voterAddress.toLowerCase() === this.wallet.address.toLowerCase()) { clientRewardHash = hash; }
      return hash;
    });
    let dataMerkleTree = new MerkleTree(rewardClaimHashes);
    let dataMerkleRoot = dataMerkleTree.root!;

    let priceMessage = ""
    results.map(data => {
      priceMessage += Web3.utils.padLeft(data.data.finalMedianPrice.toString(16), 8);
    });

    let message = Web3.utils.padLeft(priceEpochId.toString(16), EPOCH_BYTES * 2) + priceMessage;

    let priceMessageHash = this.provider.hashMessage("0x" + message);
    let merkleRoot = sortedHashPair(priceMessageHash, dataMerkleRoot);
    this.priceEpochResults.set(priceEpochId, {
      epochId: priceEpochId,
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
    let data = this.priceEpochData.get(epochId) || { epochId };
    this.priceEpochData.set(epochId, data);
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
    let signaturesTmp = [...this.priceEpochSignatures.get(epochId)!.values()];
    let mySignatureHash = this.priceEpochResults.get(epochId)!.merkleRoot!;
    let signatures = signaturesTmp
      .filter(sig => sig.merkleRoot === mySignatureHash)
      .map(sig => {
        return {
          v: sig.v,
          r: sig.r,
          s: sig.s
        } as BareSignature
      })
    return await this.provider.finalize(epochId, mySignatureHash, signatures, this.wallet.address);
  }

  async publishPriceFeeds(epochId: number) {
    let result = this.priceEpochResults.get(epochId);
    if (!result) {
      throw new Error("Result not found");
    }
    // console.log(result.dataMerkleRoot, result.fullPriceMessage, result.merkleRoot)
    return await this.provider.publishPrices(result, this.wallet.address);
  }

  async claimReward(epochId: number) {
    let result = this.priceEpochResults.get(epochId)!;
    let rewardClaim = result.rewards.get(this.wallet.address.toLowerCase());
    let proof = result.dataMerkleProof;
    if (rewardClaim && proof) {
      rewardClaim.merkleProof = proof;
      return this.provider.claimReward(rewardClaim);
    }
    else {
      return null;
    }
  }

  async offerRewards(offers: Offer[]) {
    await this.provider.offerRewards(offers);
  }
}