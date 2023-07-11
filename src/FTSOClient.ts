
import BN from "bn.js";
import Web3 from "web3";
import { toBN } from "../test-utils/utils/test-helpers";
import { MerkleTree } from "./MerkleTree";
import { RewardCalculator } from "./RewardCalculator";
import { calculateMedian } from "./median-calculation-utils";
import { IPriceFeed } from "./price-feeds/IPriceFeed";
import { IVotingProvider } from "./providers/IVotingProvider";
import { BareSignature, ClaimReward, EpochData, EpochResult, Feed, MedianCalculationResult, RevealBitvoteData, RevealResult, RewardOffered, SignatureData, TxData, VoterWithWeight } from "./voting-interfaces";
import { ZERO_BYTES32, feedId, hashClaimReward, sortedHashPair, unprefixedSymbolBytes } from "./voting-utils";

const EPOCH_BYTES = 4;
const PRICE_BYTES = 4;

const NON_EXISTENT_PRICE = 0;
const web3 = new Web3();

function padEndArray(array: any[], minLength: number, fillValue: any = undefined) {
  return Object.assign(new Array(minLength).fill(fillValue), array);
}

/**
 * A generic class for FTSO client implementation.
 * It supports pluggable price feeds and voting providers (Truffle for testing, Web3 for production).
 */
export class FTSOClient {
  provider: IVotingProvider;
  rewardCalculator!: RewardCalculator;

  startBlock: number = 0;
  lastProcessedBlockNumber: number = 0;
  voters: string[] = [];
  blockTimestamps = new Map<number, number>();
  priceEpochCommits = new Map<number, Map<string, string>>()
  priceEpochReveals = new Map<number, Map<string, RevealBitvoteData>>();
  priceEpochSignatures = new Map<number, Map<string, SignatureData>>();
  priceEpochData = new Map<number, EpochData>();
  priceEpochResults = new Map<number, EpochResult>();

  // reward epoch => voter => weight
  eligibleVotersForRewardEpoch = new Map<number, VoterWithWeight[]>();
  eligibleVoterWeights = new Map<number, Map<string, BN>>();
  eligibleVoterTotalWeight = new Map<number, BN>();

  rewardEpochOffers = new Map<number, RewardOffered[]>();
  rewardEpochOffersClosed = new Map<number, boolean>();

  startBlockNumber: number = 0;

  priceFeeds: Map<string, IPriceFeed> = new Map<string, IPriceFeed>();

  verbose: boolean = false;

  constructor(
    provider: IVotingProvider,
  ) {    
    this.provider = provider;
  }

  public registerPriceFeeds(priceFeeds: IPriceFeed[]) {
    for (let priceFeed of priceFeeds) {
      this.priceFeeds.set(feedId(priceFeed.getFeedInfo()), priceFeed);
    }
  }

  public initializeRewardCalculator(
    initialRewardEpoch: number
  ) {
    this.rewardCalculator = new RewardCalculator(this, initialRewardEpoch);
  }

  private priceEpochIdForTime(timestamp: number): number {
    return Math.floor((timestamp - this.provider.firstEpochStartSec) / this.provider.epochDurationSec);
  }

  private revealEpochIdForTime(timestamp: number): number | undefined {
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

  registerRewardsForRewardEpoch(rewardEpochId: number, forceClosure = false) {
    if (!this.rewardCalculator) {
      throw new Error("Reward calculator not initialized");
    }
    let rewardOffers = this.rewardEpochOffers.get(rewardEpochId);
    if (!rewardOffers) {
      if (forceClosure) {
        rewardOffers = [];
      } else {
        throw new Error(`Reward offers for reward epoch ${rewardEpochId} not found`);
      }
    }
    if (this.rewardEpochOffersClosed.get(rewardEpochId)) {
      throw new Error("Reward epoch is already closed");
    }
    this.rewardCalculator.setRewardOffers(rewardEpochId, rewardOffers);
    this.rewardEpochOffersClosed.set(rewardEpochId, true);
  }

  async initialize(startBlockNumber: number, rpcLink?: string, providedWeb3?: Web3, logger?: any) {
    this.startBlockNumber = startBlockNumber;
    this.lastProcessedBlockNumber = startBlockNumber - 1;

    // this.initializeWeb3(rpcLink, providedWeb3, logger);
  }

  setVerbose(verbose: boolean) {
    this.verbose = verbose;
  }

  get address() {
    return this.provider.senderAddressLowercase
  }
  
  async processBlock(blockNumber: number) {
    let block = await this.provider.getBlock(blockNumber);
    this.blockTimestamps.set(block.number, block.timestamp);
    for (let tx of block.transactions) {
      tx.receipt = await this.provider.getTransactionReceipt(tx.hash);
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
    let offers: RewardOffered[] = this.provider.extractOffers(tx);
    let currentPriceEpochId = this.priceEpochIdForTime(this.blockTimestamps.get(tx.blockNumber)!);
    let currentRewardEpochId = this.rewardEpochIdForPriceEpochId(currentPriceEpochId);
    let nextRewardEpoch = currentRewardEpochId + 1;
    if (offers && offers.length > 0) {
      if (this.rewardEpochOffersClosed.get(nextRewardEpoch)) {
        throw new Error("Reward epoch is closed");
      }
    }
    let offersInEpoch = this.rewardEpochOffers.get(nextRewardEpoch) ?? [];
    this.rewardEpochOffers.set(nextRewardEpoch, offersInEpoch)

    for (let offer of offers) {
      offersInEpoch.push(offer);
    }
  }

  // commit(bytes32 _commitHash)
  private extractCommit(tx: TxData): void {
    let hash = this.provider.extractCommitHash(tx);
    let from = tx.from.toLowerCase();
    let epochId = this.priceEpochIdForTime(this.blockTimestamps.get(tx.blockNumber)!);
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
    let hash = this.hashForCommit(this.provider.senderAddressLowercase, epochData.random!, epochData.merkleRoot!, epochData.pricesHex!);
    await this.provider.commit(hash);
  }

  async onReveal(epochId: number) {
    let epochData = this.priceEpochData.get(epochId)
    if (!epochData) {
      throw new Error("Epoch data not found");
    }
    await this.provider.revealBitvote(epochData);
  }

  async onSign(epochId: number, skipCalculation = false) {
    if (!skipCalculation) {
      await this.calculateResults(epochId);
    }
    let result = this.priceEpochResults.get(epochId);
    if (!result) {
      throw new Error("Result not found");
    }

    let signature = await this.provider.signMessage(result.merkleRoot!);
    await this.provider.signResult(epochId,
      result.merkleRoot!,
      {
        v: signature.v,
        r: signature.r,
        s: signature.s
      }
    );
  }

  // Encoding of signed result
  // [4 epochId][32-byte merkle root][4-byte price sequence]

  private calculateRevealers(priceEpochId: number): RevealResult {
    let rewardEpochId = this.rewardEpochIdForPriceEpochId(priceEpochId);
    let commits = this.priceEpochCommits.get(priceEpochId);
    let reveals = this.priceEpochReveals.get(priceEpochId);
    if (!commits || !reveals) {
      // TODO: check if this is correct
      throw new Error("Commits or reveals not found");
    }
    
    let eligibleCommitters = [...commits.keys()].map(sender => sender.toLowerCase()).filter(voter => this.eligibleVoterWeights.get(rewardEpochId)?.has(voter.toLowerCase())!);
    let revealed = eligibleCommitters      
      .filter(sender => {
        let revealData = reveals!.get(sender);
        if (!revealData) {
          return false;
        }
        let commitHash = this.priceEpochCommits.get(priceEpochId)?.get(sender);
        return commitHash === this.hashForCommit(sender, revealData.random, revealData.merkleRoot, revealData.prices);
      });
    let failedCommit = [...this.eligibleVoterWeights.get(rewardEpochId)?.keys()!].filter(voter => !revealed.includes(voter.toLowerCase()));
    let revealedSet = new Set<string>(revealed);
    let committedFailedReveal = eligibleCommitters.filter(voter => !revealedSet.has(voter.toLowerCase()));
    let revealedRandoms = revealed.map(voter => reveals!.get(voter.toLowerCase())!.random);
    return {
      revealed,
      failedCommit,
      committedFailedReveal,
      revealedRandoms
    } as RevealResult;
  }

  /**
   * Returns the list of eligible voters with their weights for the given reward epoch.
   * It reads the data from the provider and caches it.
   * @param rewardEpoch 
   * @returns 
   */
  async refreshVoterToWeightMaps(rewardEpoch: number): Promise<void> {
    let eligibleVoters = this.eligibleVotersForRewardEpoch.get(rewardEpoch);
    if(!this.eligibleVoterWeights.has(rewardEpoch)) {
      eligibleVoters = await this.provider.allVotersWithWeightsForRewardEpoch(rewardEpoch);
      this.eligibleVotersForRewardEpoch.set(rewardEpoch, eligibleVoters);
      let weightMap = new Map<string, BN>();
      this.eligibleVoterWeights.set(rewardEpoch, weightMap);
      let totalWeight = toBN(0);
      for(let voter of eligibleVoters) {
        weightMap.set(voter.voterAddress.toLowerCase(), voter.weight);
        totalWeight = totalWeight.add(voter.weight);
      }
      this.eligibleVoterTotalWeight.set(rewardEpoch, totalWeight);
    }    
  }
  
  /**
   * 
   * @param priceEpochId 
   * @param symbolMap 
   * @returns 
   */
  async calculateResults(priceEpochId: number) {
    let rewardEpoch = this.rewardEpochIdForPriceEpochId(priceEpochId);
    await this.refreshVoterToWeightMaps(rewardEpoch);
    
    let revealResult = this.calculateRevealers(priceEpochId)!;
    if(revealResult.revealed.length === 0) {
      console.log("No reveals !!!!!!!!!");
      // TODO: check when this can happen
      return;
    }
    let orderedPriceFeeds = this.orderedPriceFeeds(priceEpochId);
    let numberOfFeeds = orderedPriceFeeds.length;

    
    let voters = revealResult.revealed;
    let weights = voters.map(voter => this.eligibleVoterWeights.get(rewardEpoch)!.get(voter.toLowerCase())!);

    let pricesForVoters = voters.map(voter => {
      let revealData = this.priceEpochReveals.get(priceEpochId)!.get(voter.toLowerCase())!;
      let feeds = revealData.prices.slice(2).match(/(.{1,8})/g)?.map(hex => parseInt(hex, 16)) || [];
      feeds = feeds.slice(0, numberOfFeeds);
      return padEndArray(feeds, numberOfFeeds, 0);
    });

    let results: MedianCalculationResult[] = [];
    for (let i = 0; i < numberOfFeeds; i++) {
      let prices = pricesForVoters.map(allPrices => toBN(allPrices[i]));
      let data = calculateMedian(voters, prices, weights);
      results.push({
        feed: {
          offerSymbol: orderedPriceFeeds[i]?.getFeedInfo().offerSymbol,
          quoteSymbol: orderedPriceFeeds[i]?.getFeedInfo().quoteSymbol,
        } as Feed,
        voters: voters,
        prices: prices.map(price => price.toNumber()),
        data: data,
        weights: weights,
      } as MedianCalculationResult);
    }

    this.rewardCalculator.calculateClaimsForPriceEpoch(priceEpochId, results);
    let rewards = this.rewardCalculator.getRewardMappingForPriceEpoch(priceEpochId);
    let rewardClaimHashes: string[] = [];
    for (let claimRewardList of rewards.values()) {
      for (let claim of claimRewardList) {
        claim.hash = hashClaimReward(claim, this.provider.abiForName.get("claimRewardBodyDefinition")!);
        rewardClaimHashes.push(claim.hash);
      }
    }

    let dataMerkleTree = new MerkleTree(rewardClaimHashes);
    let dataMerkleRoot = dataMerkleTree.root!;

    let priceMessage = "";
    let symbolMessage = "";
    results.map(data => {
      priceMessage += Web3.utils.padLeft(data.data.finalMedianPrice.toString(16), PRICE_BYTES * 2);
      symbolMessage += unprefixedSymbolBytes(data.feed);
    });

    let message = Web3.utils.padLeft(priceEpochId.toString(16), EPOCH_BYTES * 2) + priceMessage + symbolMessage;

    let priceMessageHash = this.provider.hashMessage("0x" + message);
    let merkleRoot = sortedHashPair(priceMessageHash, dataMerkleRoot);

    // add merkle proofs to the claims for this FTSO client
    rewards.get(this.provider.senderAddressLowercase)?.forEach(claim => {
      if (!claim.hash) {
        throw new Error("Assert: Claim hash must be calculated.");
      }
      let merkleProof = dataMerkleTree.getProof(claim.hash!);
      if (!merkleProof) {
        throw new Error("Assert: Merkle proof must be set. ");
      }
      claim.merkleProof = merkleProof;
      // Adding the price message hash to the merkle proof, due to construction of the tree
      claim.merkleProof.push(priceMessageHash);
    });
    
    this.priceEpochResults.set(priceEpochId, {
      priceEpochId: priceEpochId,
      medianData: results,
      priceMessage: "0x" + priceMessage,
      symbolMessage: "0x" + symbolMessage,
      fullPriceMessage: "0x" + message,
      fullMessage: dataMerkleRoot + message,
      dataMerkleRoot,
      dataMerkleProof: priceMessageHash,
      rewards,
      merkleRoot
    } as EpochResult);
  }

  orderedPriceFeeds(priceEpochId: number): (IPriceFeed | undefined)[] {
    let rewardEpoch = this.rewardEpochIdForPriceEpochId(priceEpochId);
    return this.rewardCalculator.getFeedSequenceForRewardEpoch(rewardEpoch).map(feed => this.priceFeeds.get(feedId(feed)));
  }

  preparePriceFeedsForPriceEpoch(priceEpochId: number) {
    let data = this.priceEpochData.get(priceEpochId) || { epochId: priceEpochId };
    this.priceEpochData.set(priceEpochId, data);
    data.merkleRoot = ZERO_BYTES32;
    data.prices = this.orderedPriceFeeds(priceEpochId).map(priceFeed => priceFeed ? priceFeed.getPriceForEpoch(priceEpochId) : NON_EXISTENT_PRICE);
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
    return await this.provider.finalize(epochId, mySignatureHash, signatures);
  }

  async publishPrices(epochId: number, symbolIndices: number[]) {
    let result = this.priceEpochResults.get(epochId);
    if (!result) {
      throw new Error("Result not found");
    }
    // console.log(result.dataMerkleRoot, result.fullPriceMessage, result.merkleRoot)
    return await this.provider.publishPrices(result, symbolIndices);
  }

  async claimReward(rewardEpochId: number) {
    let claimPriceEpochId = this.rewardCalculator.firstRewardedPriceEpoch + this.rewardCalculator.rewardEpochDurationInEpochs * (rewardEpochId + 1) - 1;
    let result = this.priceEpochResults.get(claimPriceEpochId)!;

    let rewardClaims = result.rewards.get(this.provider.senderAddressLowercase) || [];
    let receipts = [];
    for (let rewardClaim of rewardClaims) {
      let receipt = await this.provider.claimReward(rewardClaim);
      receipts.push(receipt);
    }
    return receipts;
  }

  /**
   * Returns the list of claims for the given reward epoch and claimer.
   * @param rewardEpochId 
   * @param claimer 
   * @returns 
   */
  claimsForClaimer(rewardEpochId: number, claimer: string): ClaimReward[] {
    let claimPriceEpochId = this.rewardCalculator.firstRewardedPriceEpoch + this.rewardCalculator.rewardEpochDurationInEpochs * (rewardEpochId + 1) - 1;
    let result = this.priceEpochResults.get(claimPriceEpochId)!;
    return result.rewards.get(claimer.toLowerCase()) || [];
  }

}