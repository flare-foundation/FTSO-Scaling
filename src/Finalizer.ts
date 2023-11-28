import BN from "bn.js";
import { getLogger } from "./utils/logger";
import { errorString } from "./protocol/utils/error";
import { Event } from "./protocol/BlockIndex";
import { FinalizeData, PriceEpochId, RewardEpochId, SignatureData } from "./protocol/voting-types";
import { toBN } from "./protocol/utils/voting-utils";
import _ from "lodash";
import { EpochSettings } from "./protocol/utils/EpochSettings";
import { IVotingProvider } from "./protocol/IVotingProvider";
import { runWithDuration, sleepFor } from "./utils/time";
import { BlockIndexer } from "./BlockIndexer";

export class Finalizer {
  private readonly logger = getLogger(Finalizer.name);

  constructor(
    private readonly provider: IVotingProvider,
    private readonly index: BlockIndexer,
    private readonly epochs: EpochSettings
  ) {}

  private readonly priceSignaturesByEpoch = new Map<PriceEpochId, SignatureData[]>();
  private readonly rewardSignaturesByEpoch = new Map<RewardEpochId, SignatureData[]>();

  private finalizedEpoch = 0;
  private finalizedRewardEpoch = 0;

  async run() {
    // this.listenAndFinalizeRewardEpoch(); // TODO: Fix once we have rewarding client implemented.

    await this.index.initialize();

    while (true) {
      const currentVotingEpoch = this.epochs.priceEpochIdForTime(this.currentTimeSec());

      if (this.finalizedEpoch < currentVotingEpoch - 1) {
        const finalize = await this.index.queryFinalize(currentVotingEpoch);
        if (finalize !== undefined) {
          this.logger.info(`Got finalize for ${finalize[0].epochId}.`);
          this.finalizedEpoch = Math.max(this.finalizedEpoch, finalize[0].epochId);
        }

        this.logger.info(`[${currentVotingEpoch}] Finalizer loop - querying signatures.`);
        const epochSignatures = await this.index.querySignatures(currentVotingEpoch);
        if (epochSignatures.size > 0) {
          await this.onSignatures(
            currentVotingEpoch - 1,
            Array.from(epochSignatures.values(), s => s[0])
          );
        }
      }

      await sleepFor(1000);
    }
  }

  async onSignatures(previousEpochId: number, signatures: SignatureData[]) {
    const signaturesForEpoch = signatures.filter(s => s.epochId === previousEpochId);

    this.logger.info(`Got ${signaturesForEpoch.length} signatures for epoch ${previousEpochId}.`);

    const rewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(previousEpochId);
    const weightThreshold = await this.provider.thresholdForRewardEpoch(rewardEpoch);
    const voterWeights = await this.provider.getVoterWeightsForRewardEpoch(rewardEpoch);

    const validSignatures = await runWithDuration(
      "PRICE_SIGS",
      async () => await this.getSignaturesForFinalization(signaturesForEpoch, weightThreshold, voterWeights)
    );
    if (validSignatures !== undefined) {
      const [mroot, sigs] = validSignatures;
      await runWithDuration("PRICE_FINALIZE", async () => {
        this.logger.info(`Finalizing epoch ${previousEpochId} with merkle root ${mroot}.`);
        await this.tryFinalizePriceEpoch(previousEpochId, mroot, [...sigs.values()]);
        this.finalizedEpoch = Math.max(this.finalizedEpoch, previousEpochId);
      });

      return true;
    }
  }

  // private listenAndFinalizeRewardEpoch() {
  //   this.index.on(Event.RewardFinalize, (fd: FinalizeData) => {
  //     this.finalizedRewardEpoch = Math.max(this.finalizedRewardEpoch, fd.epochId);
  //     this.rewardSignaturesByEpoch.delete(fd.epochId);
  //   });

  //   this.index.on(Event.RewardSignature, async (signature: SignatureData) => {
  //     this.logger.info(`Received reward signature for epoch ${signature.epochId}.`);
  //     if (signature.epochId <= this.finalizedRewardEpoch) return;

  //     const signaturesForEpoch = this.rewardSignaturesByEpoch.get(signature.epochId) ?? [];
  //     signaturesForEpoch.push(signature);
  //     this.rewardSignaturesByEpoch.set(signature.epochId, signaturesForEpoch);

  //     const weightThreshold = await this.provider.thresholdForRewardEpoch(signature.epochId);
  //     const voterWeights = await this.provider.getVoterWeightsForRewardEpoch(signature.epochId);

  //     const signatures = await runWithDuration(
  //       "REWARD_SIGS",
  //       async () => await this.getSignaturesForFinalization(signaturesForEpoch, weightThreshold, voterWeights)
  //     );
  //     if (signatures !== undefined) {
  //       const [mroot, sigs] = signatures;
  //       await runWithDuration("REWARD_FINALIZE", async () => {
  //         if (await this.tryFinalizeRewardEpoch(signature.epochId, mroot, [...sigs.values()])) {
  //           this.finalizedRewardEpoch = Math.max(this.finalizedRewardEpoch, signature.epochId);
  //         }
  //       });

  //       return true;
  //     }
  //   });
  // }

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
      this.logger.info(`Failed to submit finalization transaction.`);
      this.logger.debug(`Finalization error: ${errorString(e)}`);

      return false;
    }
  }

  // private async tryFinalizeRewardEpoch(
  //   rewardEpoch: number,
  //   merkleRoot: string,
  //   signatures: SignatureData[]
  // ): Promise<boolean> {
  //   try {
  //     this.logger.info(`Submitting finalization transaction for reward epoch ${rewardEpoch}.`);
  //     await this.provider.finalizeRewards(rewardEpoch, merkleRoot, signatures);
  //     this.logger.info(`Successfully submitted finalization transaction for reward epoch ${rewardEpoch}.`);
  //     return true;
  //   } catch (e) {
  //     this.logger.info(`Failed to submit finalization transaction: ${errorString(e)}`);
  //     return false;
  //   }
  // }

  private currentTimeSec(): number {
    return Math.floor(Date.now() / 1000);
  }
}
