import { getLogger } from "./utils/logger";
import { Received } from "./BlockIndex";
import { Address, FinalizeData, PriceEpochId, RewardClaim, RewardEpochId } from "./protocol/voting-types";
import { BlockIndexer } from "./BlockIndexer";
import { getAccount, getBlockNumberBefore } from "./utils/web3";
import Web3 from "web3";
import { hashRewardClaim } from "./protocol/utils/voting-utils";

import { asError } from "./utils/error";
import { Account } from "web3-core";
import { MerkleTree } from "./protocol/utils/MerkleTree";
import { Penalty, RewardLogic } from "./protocol/RewardLogic";
import { IVotingProvider } from "./providers/IVotingProvider";
import { EpochSettings } from "./protocol/utils/EpochSettings";
import { FTSOClient } from "./FTSOClient";

export class RewardVoter {
  private readonly logger = getLogger(RewardVoter.name);
  private readonly client: FTSOClient;
  private readonly epochs: EpochSettings;
  private readonly indexer: BlockIndexer;

  private voterAccount: Account;

  constructor(private readonly provider: IVotingProvider, private voterKey: string, private web3: Web3) {
    this.epochs = EpochSettings.fromProvider(provider);
    this.indexer = new BlockIndexer(provider);
    this.client = new FTSOClient(this.provider, this.indexer, this.epochs);
    this.voterAccount = getAccount(this.web3, this.voterKey);
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
    await this.provider.authorizeClaimer(this.provider.senderAddressLowercase, this.voterAccount);

    const currentPriceEpoch = this.epochs.priceEpochIdForTime(this.currentTimeSec());
    const currentRewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(currentPriceEpoch);

    // We should process data from the start of the previuos reward epoch so we pick up reward offers for the current one.
    const previousRewardEpoch = Math.max(currentRewardEpoch - 1, 0);
    const previousRewardEpochStartTimeSec = this.epochs.priceEpochStartTimeSec(
      this.epochs.firstPriceEpochForRewardEpoch(previousRewardEpoch)
    );

    const currBlock = await this.web3.eth.getBlock("latest");
    this.logger.info(
      `Current block time ${new Date(+currBlock.timestamp * 1000).toISOString()}, want to get block before ${new Date(
        previousRewardEpochStartTimeSec * 1000
      ).toISOString()}`
    );

    let startBlock = await getBlockNumberBefore(this.web3, previousRewardEpochStartTimeSec * 1000);
    if (startBlock === undefined) startBlock = 1;

    this.logger.info(`Starting from block ${startBlock} for reward epoch ${previousRewardEpoch}.`);

    this.setUpCalculateRewards();
    this.setUpClaimRewards();

    this.indexer.run(startBlock);
  }

  private setUpCalculateRewards() {
    this.indexer.on(Received.Finalize, async (from: string, finalizeData: FinalizeData) => {
      this.logger.info(`[${finalizeData.epochId}] Received finalize from ${from}.`);
      const finalizedEpoch = finalizeData.epochId;
      const rewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(finalizedEpoch);

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

  private setUpClaimRewards() {
    this.indexer.on(Received.RewardFinalize, async (from: Address, fd: FinalizeData) => {
      this.logger.info(`[${fd.epochId}] Received reward finalize from ${from}`);
      const rewardClaims = this.rewardClaimsForEpoch.get(fd.epochId)!;
      const claimable = rewardClaims.filter(claim => !(claim instanceof Penalty));

      const cwp = RewardLogic.generateProofsForClaims(claimable, fd.merkleRoot, this.voterAccount.address);
      this.logger.info(`[${fd.epochId}] Claiming ${cwp.length} rewards for epoch.`);
      return await this.provider.claimRewards(cwp, this.voterAccount.address);
    });
  }

  private async signRewards(cumulativeClaims: RewardClaim[], rewardEpoch: RewardEpochId, priceEpoch: PriceEpochId) {
    this.logger.info(`[${rewardEpoch}] Signing rewards for epoch.`);
    const rewardClaims = cumulativeClaims.filter(claim => !(claim instanceof Penalty));
    const rewardClaimHashes: string[] = rewardClaims.map(claim => hashRewardClaim(claim));
    const rewardMerkleTree = new MerkleTree(rewardClaimHashes);
    const rewardMerkleRoot = rewardMerkleTree.root!;

    this.logger.info(`Signing reward merkle root for epoch ${priceEpoch}: ${rewardMerkleRoot}`);

    const signature = await this.provider.signMessageWithKey(rewardMerkleRoot, this.voterKey);

    await this.provider.signRewards(rewardEpoch, rewardMerkleRoot!, {
      v: signature.v,
      r: signature.r,
      s: signature.s,
    });
  }

  private isLastPriceEpochInRewardEpoch(priceEpochId: PriceEpochId): boolean {
    const rewardEpoch = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId);
    const rewardEpochForNext = this.epochs.rewardEpochIdForPriceEpochId(priceEpochId + 1);
    return rewardEpochForNext > rewardEpoch;
  }

  private currentTimeSec(): number {
    return Math.floor(Date.now() / 1000);
  }
}
