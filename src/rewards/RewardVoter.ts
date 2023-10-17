import { getLogger } from "../utils/logger";
import { Received } from "../BlockIndex";
import { Address, FinalizeData, PriceEpochId, RewardClaim, RewardEpochId } from "../protocol/voting-types";
import { BlockIndexer } from "./BlockIndexer";
import { getAccount, getBlockNumberBefore } from "../utils/web3";
import { FTSOClient } from "../FTSOClient";
import Web3 from "web3";
import { hashRewardClaim } from "../protocol/voting-utils";

import { asError } from "../utils/error";
import { Web3Provider } from "../providers/Web3Provider";
import { Account } from "web3-core";
import { MerkleTree } from "../utils/MerkleTree";
import { Penalty, RewardLogic } from "../protocol/RewardLogic";

export class RewardVoter {
  private readonly logger = getLogger(RewardVoter.name);
  private readonly indexer: BlockIndexer;

  private voterAccount: Account;
  private voterAdress: Address;

  constructor(private client: FTSOClient, private voterKey: string, private web3: Web3) {
    this.indexer = client.index as BlockIndexer;
    this.voterAccount = getAccount(this.web3, this.voterKey);
    this.voterAdress = this.voterAccount.address;
  }
  private readonly rewardClaimsForEpoch = new Map<RewardEpochId, RewardClaim[]>();

  async run() {
    try {
      await this.runLogic();
    } catch (e: unknown) {
      this.logger.error(`Error while running logic, ${asError(e)}`);
      throw e;
    }
  }

  async runLogic() {
    await (this.client.provider as Web3Provider).authorizeClaimerFrom(this.client.address, this.voterAccount);

    const currentPriceEpoch = this.client.epochs.priceEpochIdForTime(this.currentTimeSec());
    const currentRewardEpoch = this.client.epochs.rewardEpochIdForPriceEpochId(currentPriceEpoch);

    const currBlock = await this.web3.eth.getBlock("latest");
    const tsMs = +currBlock.timestamp * 1000;

    // We should process data from the start of the previuos reward epoch so we pick up reward offers for the current one.
    const previousRewardEpoch = Math.max(currentRewardEpoch - 1, 0);
    const previousRewardEpochStartTimeSec = this.client.epochs.priceEpochStartTimeSec(
      this.client.epochs.firstPriceEpochForRewardEpoch(previousRewardEpoch)
    );

    this.logger.info(
      `Current block time ${new Date(tsMs).toISOString()}, want to get block before ${new Date(
        previousRewardEpochStartTimeSec * 1000
      ).toISOString()}`
    );

    let startBlock = await getBlockNumberBefore(this.web3, previousRewardEpochStartTimeSec * 1000);
    if (startBlock === undefined) startBlock = 1;

    this.logger.info(`Starting from block ${startBlock} for reward epoch ${previousRewardEpoch}.`);

    this.calculateRewards();
    this.claimRewards();

    this.indexer.run(startBlock);
  }

  private calculateRewards() {
    this.indexer.on(Received.Finalize, async (from: string, finalizeData: FinalizeData) => {
      this.logger.info(`[${finalizeData.epochId}] Received finalize from ${from}.`);
      const finalizedEpoch = finalizeData.epochId;
      const rewardEpoch = this.client.epochs.rewardEpochIdForPriceEpochId(finalizedEpoch);

      this.logger.info(`Block number before now: ${await getBlockNumberBefore(this.web3, Date.now())}`);

      const rewardOffers = this.indexer.getRewardOffers(rewardEpoch)!;
      if (rewardOffers.length > 0) {
        this.logger.info(`[${finalizedEpoch}] We have offers for reward epoch ${rewardEpoch}, calculating rewards.`);
        // We have offers, means we started processing for previous reward epoch and should have all
        // required information for calculating rewards.
        const priceEpochRewardClaims = await this.client.calculateRewards(finalizedEpoch, rewardOffers);

        this.logger.info(`[${finalizedEpoch}] Calculated ${priceEpochRewardClaims.length} reward claims for epoch.`);

        const existing = this.rewardClaimsForEpoch.get(rewardEpoch) ?? [];
        const mergedClaims = RewardLogic.mergeClaims(finalizedEpoch, existing.concat(priceEpochRewardClaims));
        this.rewardClaimsForEpoch.set(rewardEpoch, mergedClaims);

        if (this.isLastPriceEpochInRewardEpoch(finalizedEpoch)) {
          await this.signRewards(mergedClaims, rewardEpoch, finalizedEpoch);
        }
      }
    });
  }

  private claimRewards() {
    this.indexer.on(Received.RewardFinalize, async (from: Address, fd: FinalizeData) => {
      this.logger.info(`[${fd.epochId}] Received reward finalize from ${from}`);
      const rewardClaims = this.rewardClaimsForEpoch.get(fd.epochId)!;
      const claimable = rewardClaims.filter(claim => !(claim instanceof Penalty));

      const cwp = RewardLogic.generateProofsForClaims(claimable, fd.merkleRoot, this.voterAdress);
      this.logger.info(`[${fd.epochId}] Claiming ${cwp.length} rewards for epoch.`);
      return await this.client.provider.claimRewards(cwp, this.voterAdress);
    });
  }

  private async signRewards(cumulativeClaims: RewardClaim[], rewardEpoch: RewardEpochId, priceEpoch: PriceEpochId) {
    this.logger.info(`[${rewardEpoch}] Signing rewards for epoch.`);
    const rewardClaims = cumulativeClaims.filter(claim => !(claim instanceof Penalty));
    const rewardClaimHashes: string[] = rewardClaims.map(claim => hashRewardClaim(claim));
    const rewardMerkleTree = new MerkleTree(rewardClaimHashes);
    const rewardMerkleRoot = rewardMerkleTree.root!;

    this.logger.info(`Signing reward merkle root for epoch ${priceEpoch}: ${rewardMerkleRoot}`);

    const signature = await this.client.provider.signMessageWithKey(rewardMerkleRoot, this.voterKey);

    await this.client.provider.signRewards(rewardEpoch, rewardMerkleRoot!, {
      v: signature.v,
      r: signature.r,
      s: signature.s,
    });
  }

  private isLastPriceEpochInRewardEpoch(priceEpochId: PriceEpochId): boolean {
    const rewardEpoch = this.client.epochs.rewardEpochIdForPriceEpochId(priceEpochId);
    const rewardEpochForNext = this.client.epochs.rewardEpochIdForPriceEpochId(priceEpochId + 1);
    return rewardEpochForNext > rewardEpoch;
  }

  private currentTimeSec(): number {
    return Math.floor(Date.now() / 1000);
  }
}
