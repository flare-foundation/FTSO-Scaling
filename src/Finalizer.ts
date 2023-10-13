import BN from "bn.js";
import { FTSOClient } from "./FTSOClient";
import { getLogger } from "./utils/logger";
import { errorString } from "./utils/error";
import { BlockIndex, Received } from "./BlockIndex";
import { FinalizeData, SignatureData } from "./voting-interfaces";
import { toBN } from "./voting-utils";
import _ from "lodash";

export class Finalizer {
  private readonly logger = getLogger(Finalizer.name);
  private readonly index: BlockIndex;

  constructor(private client: FTSOClient) {
    this.index = this.client.index;
  }

  readonly signaturesByEpoch = new Map<number, SignatureData[]>();

  finalizedEpoch = 0;

  async run() {
    await this.client.processNewBlocks(); // Initial catchup.

    // Process new blocks continuously
    setInterval(async () => {
      await this.client.processNewBlocks();
    }, 1000);

    this.index.on(Received.Finalize, (fd: FinalizeData) => {
      this.finalizedEpoch = Math.max(this.finalizedEpoch, fd.epochId);
      this.signaturesByEpoch.delete(fd.epochId);
    });

    this.index.on(Received.Signature, async (signature: SignatureData) => {
      this.logger.info(`Received signature for epoch ${signature.epochId}.`);
      if (signature.epochId <= this.finalizedEpoch) return;

      const signaturesForEpoch = this.signaturesByEpoch.get(signature.epochId) ?? [];
      signaturesForEpoch.push(signature);
      this.signaturesByEpoch.set(signature.epochId, signaturesForEpoch);

      const rewardEpoch = this.client.epochs.rewardEpochIdForPriceEpochId(signature.epochId);
      const weightThreshold = await this.client.provider.thresholdForRewardEpoch(rewardEpoch);
      const voterWeights = await this.getVoterWeights(rewardEpoch);

      const res = await this.checkSignatures(signaturesForEpoch, weightThreshold, voterWeights);
      if (res !== undefined) {
        const [mroot, sigs] = res;
        if (await this.tryFinalizePriceEpoch(signature.epochId, mroot, [...sigs.values()])) {
          this.finalizedEpoch = Math.max(this.finalizedEpoch, signature.epochId);
        }

        return true;
      }
    });
  }

  // async onPriceEpoch() {
  //   const currentPriceEpochId = this.client.epochs.priceEpochIdForTime(this.currentTimeSec());
  //   const previousEpochId = currentPriceEpochId - 1;

  //   const rewardEpoch = this.client.epochs.rewardEpochIdForPriceEpochId(previousEpochId);
  //   const weightThreshold = await this.client.provider.thresholdForRewardEpoch(rewardEpoch);
  //   const voterWeights = await this.getVoterWeights(rewardEpoch);

  //   this.logger.info(`[${currentPriceEpochId}] Processing price epoch.`);

  //   const signatures: SignatureData[] = [];

  //   const signatureListener = async (signature: SignatureData) => {
  //     if (signature.epochId != previousEpochId) {
  //       this.logger.info(
  //         `[${currentPriceEpochId}] Received signature for different epoch than the previous one. Expected: ${previousEpochId}, received: ${signature.epochId}. Ignoring.`
  //       );
  //       if (signature.epochId > previousEpochId + 1) {
  //         // Assume voting did not take place for the previous epoch.
  //         this.logger.info(
  //           `[${currentPriceEpochId}] Received signature is 2 or more epochs ahead of the current one, aborting processing.`
  //         );
  //         this.index.off(Received.Signature, signatureListener);
  //       }
  //       return;
  //     }

  //     signatures.push(signature);
  //     const res = await this.checkSignatures(signatures, weightThreshold, voterWeights);
  //     if (res !== undefined) {
  //       const [mroot, sigs] = res;
  //       if (await this.tryFinalizePriceEpoch(previousEpochId, mroot, [...sigs.values()])) {
  //         this.index.off(Received.Signature, signatureListener);
  //       }
  //       return true;
  //     }
  //   };
  //   const finalizeListener = (_from: string, fd: FinalizeData) => {
  //     if (fd.epochId == previousEpochId) {
  //       this.index.off(Received.Signature, signatureListener);
  //       this.index.off(Received.Finalize, finalizeListener);
  //       this.logger.info(`[${currentPriceEpochId}] Epoch finalized, listener for ${previousEpochId} removed.`);
  //     }
  //   };

  //   this.index.on(Received.Signature, signatureListener);
  //   this.index.on(Received.Finalize, finalizeListener);
  // }

  /**
   * Once sufficient voter weight in received signatures is observed, will call finalize.
   */
  private async checkSignatures(
    signatures: SignatureData[],
    weightThreshold: BN,
    voterWeights: Map<string, BN>
  ): Promise<[string, SignatureData[]] | undefined> {
    const signaturesByMerkleRoot = _.groupBy(signatures, s => s.merkleRoot);
    // We don't know what the correct merkle root for the epoch is,
    // so we'll try all and use the one with enough weight behind it for finalization.
    for (const mroot in signaturesByMerkleRoot) {
      let totalWeight = toBN(0);
      const validatedSignatures = new Map<string, SignatureData>();
      for (const signature of signaturesByMerkleRoot[mroot]) {
        const signer = await this.client.provider.recoverSigner(mroot, signature);
        // Deduplicate signers, since the same signature can in theory be published multiple times by different accounts.
        if (validatedSignatures.has(signer)) continue;

        const weight = voterWeights.get(signer) ?? toBN(0);
        // Weight == 0 could mean that the signer is not registered for this reward epoch OR that the signature is invalid.
        // We skip the signature in both cases.
        if (weight.gt(toBN(0))) {
          validatedSignatures.set(signer, signature);
          totalWeight = totalWeight.add(weight);

          if (totalWeight.gt(weightThreshold)) {
            return [mroot, Array.from(validatedSignatures.values())];
          }
        }
      }
    }

    return undefined;
  }

  private async tryFinalizePriceEpoch(
    priceEpochId: number,
    merkleRoot: string,
    signatures: SignatureData[]
  ): Promise<boolean> {
    try {
      this.logger.info(`Submitting finalization transaction for epoch ${priceEpochId}.`);
      await this.client.provider.finalize(priceEpochId, merkleRoot, signatures);
      this.logger.info(`Successfully submitted finalization transaction for epoch ${priceEpochId}.`);
      return true;
    } catch (e) {
      this.logger.info(`Failed to submit finalization transaction: ${errorString(e)}`);
      return false;
    }
  }

  private async tryFinalizeRewardEpoch(
    rewardEpoch: number,
    merkleRoot: string,
    signatures: SignatureData[]
  ): Promise<boolean> {
    try {
      this.logger.info(`Submitting finalization transaction for reward epoch ${rewardEpoch}.`);
      await this.client.provider.finalizeRewards(rewardEpoch, merkleRoot, signatures);
      this.logger.info(`Successfully submitted finalization transaction for reward epoch ${rewardEpoch}.`);
      return true;
    } catch (e) {
      this.logger.info(`Failed to submit finalization transaction: ${errorString(e)}`);
      return false;
    }
  }

  private async getVoterWeights(rewardEpoch: number): Promise<Map<string, BN>> {
    const eligibleVoters = await this.client.provider.allVotersWithWeightsForRewardEpoch(rewardEpoch);
    const weightMap = new Map(eligibleVoters.map(v => [v.voterAddress.toLowerCase(), v.weight]));
    return weightMap;
  }

  private currentTimeSec(): number {
    return Math.floor(Date.now() / 1000);
  }
}
