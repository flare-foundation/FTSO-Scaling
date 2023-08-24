import { EventEmitter } from "events";
import { ContractAddresses } from "../deployment/tasks/common";
import { encodingUtils } from "./EncodingUtils";
import { EpochSettings } from "./EpochSettings";
import { BlockData, RevealBitvoteData, SignatureData, TxData } from "./voting-interfaces";

declare type Address = string;
declare type EpochId = number;

export enum Received {
  Commit = "commit",
  Reveal = "reveal",
  Signature = "signature",
  Finalize = "finalize",
  Offers = "offers",
}

/** Processes transaction blocks and emits events based on the type of extracted data. */
export class BlockIndexer extends EventEmitter {
  private readonly priceEpochCommits = new Map<EpochId, Map<Address, string>>();
  private readonly priceEpochReveals = new Map<EpochId, Map<Address, RevealBitvoteData>>();
  private readonly priceEpochSignatures = new Map<EpochId, Map<Address, SignatureData>>();

  constructor(private readonly epochs: EpochSettings, private readonly contractAddresses: ContractAddresses) {
    super({ captureRejections: true });
  }

  getCommits(priceEpochId: EpochId): Map<Address, string> {
    return this.priceEpochCommits.get(priceEpochId) ?? new Map();
  }

  getReveals(priceEpochId: EpochId): Map<Address, RevealBitvoteData> {
    return this.priceEpochReveals.get(priceEpochId) ?? new Map();
  }

  getSignatures(priceEpochId: EpochId): Map<Address, SignatureData> {
    return this.priceEpochSignatures.get(priceEpochId) ?? new Map();
  }

  processBlock(block: BlockData) {
    for (const tx of block.transactions) {
      this.processTx(tx, block.timestamp);
    }
  }

  private processTx(tx: TxData, blockTimestampSec: number) {
    const prefix = tx.input?.slice(0, 10);
    if (tx.to?.toLowerCase() === this.contractAddresses.voting.toLowerCase()) {
      if (prefix && prefix.length === 10) {
        if (prefix === encodingUtils.functionSignature("commit")) {
          return this.extractCommit(tx, blockTimestampSec);
        } else if (prefix === encodingUtils.functionSignature("revealBitvote")) {
          return this.extractReveal(tx, blockTimestampSec);
        } else if (prefix === encodingUtils.functionSignature("signResult")) {
          return this.extractSignature(tx);
        } else if (prefix === encodingUtils.functionSignature("finalize")) {
          return this.extractFinalize(tx);
        }
      }
    } else if (tx.to?.toLowerCase() === this.contractAddresses.votingRewardManager.toLowerCase()) {
      if (prefix === encodingUtils.functionSignature("offerRewards")) {
        return this.extractOffers(tx, blockTimestampSec);
      }
    }
  }

  private extractFinalize(tx: TxData) {
    // TODO: extract signers from finalize call payload – they should get rewarded
    const successful = tx.receipt!.status == true;
    if (successful) {
      const data = encodingUtils.extractFinalize(tx);
      this.emit(Received.Finalize, tx.from, data);
    }
  }

  /**
   * Extract offers from transaction input.
   * Assumption: the transaction is a call to `offerRewards` function.
   */
  private extractOffers(tx: TxData, blockTimestampSec: number): void {
    const offers = encodingUtils.extractOffers(tx);
    const priceEpochId = this.epochs.priceEpochIdForTime(blockTimestampSec);
    this.emit(Received.Offers, priceEpochId, offers);
  }

  // commit(bytes32 _commitHash)
  private extractCommit(tx: TxData, blockTimestampSec: number): void {
    const hash = encodingUtils.extractCommitHash(tx);
    const from = tx.from.toLowerCase();
    const epochId = this.epochs.priceEpochIdForTime(blockTimestampSec);
    const commitsInEpoch = this.priceEpochCommits.get(epochId) || new Map<Address, string>();
    this.priceEpochCommits.set(epochId, commitsInEpoch);
    commitsInEpoch.set(from.toLowerCase(), hash);
  }

  // function revealBitvote(bytes32 _random, bytes32 _merkleRoot, bytes calldata _bitVote, bytes calldata _prices)
  private extractReveal(tx: TxData, blockTimestampSec: number): void {
    const result = encodingUtils.extractRevealBitvoteData(tx);
    const from = tx.from.toLowerCase();
    const epochId = this.epochs.revealEpochIdForTime(blockTimestampSec);
    if (epochId !== undefined) {
      const revealsInEpoch = this.priceEpochReveals.get(epochId) || new Map<Address, RevealBitvoteData>();
      this.priceEpochReveals.set(epochId, revealsInEpoch);
      revealsInEpoch.set(from.toLowerCase(), result);
    }
  }

  // function signResult(bytes32 _merkleRoot, Signature calldata signature)
  private extractSignature(tx: TxData): void {
    const signatureData = encodingUtils.extractSignatureData(tx);
    const from = tx.from.toLowerCase();
    const signaturesInEpoch = this.priceEpochSignatures.get(signatureData.epochId) || new Map<Address, SignatureData>();

    this.priceEpochSignatures.set(signatureData.epochId, signaturesInEpoch);
    signaturesInEpoch.set(from.toLowerCase(), signatureData);

    this.emit(Received.Signature, signatureData);
  }
}
