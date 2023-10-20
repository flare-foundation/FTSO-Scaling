import BN from "bn.js";
import { getLogger } from "./utils/logger";
import { errorString } from "./utils/error";
import { BlockIndex, Received } from "./BlockIndex";
import { FinalizeData, PriceEpochId, RewardEpochId, SignatureData } from "./protocol/voting-types";
import { toBN } from "./protocol/utils/voting-utils";
import _ from "lodash";
import { EpochSettings } from "./protocol/utils/EpochSettings";
import { IVotingProvider } from "./providers/IVotingProvider";

export class Finalizer {
  private readonly logger = getLogger(Finalizer.name);

  constructor(
    private readonly provider: IVotingProvider,
    private readonly index: BlockIndex,
    private readonly epochs: EpochSettings
  ) {}

  private readonly priceSignaturesByEpoch = new Map<PriceEpochId, SignatureData[]>();
  private readonly rewardSignaturesByEpoch = new Map<RewardEpochId, SignatureData[]>();

  private finalizedEpoch = 0;
  private finalizedRewardEpoch = 0;

  async run() {
    this.listenAndFinalizePriceEpoch();
    this.listenAndFinalizeRewardEpoch();
  }

  private listenAndFinalizeRewardEpoch() {
    this.index.on(Received.RewardFinalize, (fd: FinalizeData) => {
      this.finalizedRewardEpoch = Math.max(this.finalizedRewardEpoch, fd.epochId);
      this.rewardSignaturesByEpoch.delete(fd.epochId);
    });

    this.index.on(Received.RewardSignature, async (signature: SignatureData) => {
      this.logger.info(`Received reward signature for epoch ${signature.epochId}.`);
      if (signature.epochId <= this.finalizedRewardEpoch) return;

      const signaturesForEpoch = this.rewardSignaturesByEpoch.get(signature.epochId) ?? [];
      signaturesForEpoch.push(signature);
      this.rewardSignaturesByEpoch.set(signature.epochId, signaturesForEpoch);

      const weightThreshold = await this.provider.thresholdForRewardEpoch(signature.epochId);
      const voterWeights = await this.provider.getVoterWeightsForRewardEpoch(signature.epochId);

      const signatures = await this.getSignaturesForFinalization(signaturesForEpoch, weightThreshold, voterWeights);
      if (signatures !== undefined) {
        const [mroot, sigs] = signatures;
        if (await this.tryFinalizeRewardEpoch(signature.epochId, mroot, [...sigs.values()])) {
          this.finalizedRewardEpoch = Math.max(this.finalizedRewardEpoch, signature.epochId);
        }

        return true;
      }
    });
  }

  private listenAndFinalizePriceEpoch() {
    this.index.on(Received.Finalize, (fd: FinalizeData) => {
      this.finalizedEpoch = Math.max(this.finalizedEpoch, fd.epochId);
      this.priceSignaturesByEpoch.delete(fd.epochId);
    });

    this.index.on(Received.Signature, async (signature: SignatureData) => {
      this.logger.info(`Received signature for epoch ${signature.epochId}.`);
      if (signature.epochId <= this.finalizedEpoch) return;

      const signaturesForEpoch = this.priceSignaturesByEpoch.get(signature.epochId) ?? [];
      signaturesForEpoch.push(signature);
      this.priceSignaturesByEpoch.set(signature.epochId, signaturesForEpoch);

      const rewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(signature.epochId);
      const weightThreshold = await this.provider.thresholdForRewardEpoch(rewardEpoch);
      const voterWeights = await this.provider.getVoterWeightsForRewardEpoch(rewardEpoch);

      const signatures = await this.getSignaturesForFinalization(signaturesForEpoch, weightThreshold, voterWeights);
      if (signatures !== undefined) {
        const [mroot, sigs] = signatures;
        if (await this.tryFinalizePriceEpoch(signature.epochId, mroot, [...sigs.values()])) {
          this.finalizedEpoch = Math.max(this.finalizedEpoch, signature.epochId);
        }

        return true;
      }
    });
  }

  /**
   * Once sufficient voter weight in received signatures is observed, will call finalize.
   */
  private async getSignaturesForFinalization(
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
        const signer = await this.provider.recoverSigner(mroot, signature);
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
      await this.provider.finalize(priceEpochId, merkleRoot, signatures);
      this.logger.info(`Successfully submitted finalization transaction for epoch ${priceEpochId}.`);
      return true;
    } catch (e) {
      // this.logger.info(`Failed to submit finalization transaction: ${errorString(e)}`);
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
      await this.provider.finalizeRewards(rewardEpoch, merkleRoot, signatures);
      this.logger.info(`Successfully submitted finalization transaction for reward epoch ${rewardEpoch}.`);
      return true;
    } catch (e) {
      this.logger.info(`Failed to submit finalization transaction: ${errorString(e)}`);
      return false;
    }
  }
}
