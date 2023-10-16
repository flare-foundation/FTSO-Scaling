import { getLogger } from "../utils/logger";
import { Received } from "../BlockIndex";
import { FinalizeData, RewardClaim, RewardOffered } from "../voting-interfaces";
import { BlockIndexer } from "./BlockIndexer";
import { getAccount, getBlockNumberBefore } from "../web3-utils";
import { FTSOClient } from "../FTSOClient";
import Web3 from "web3";
import { Penalty } from "./RewardCalculator";
import { hashRewardClaim } from "../voting-utils";
import { MerkleTree } from "../MerkleTree";
import { asError } from "../utils/error";
import { Web3Provider } from "../providers/Web3Provider";
import { Account } from "web3-core";

/*

On startup, replay everything from the beginning of the reward epoch.
For every price epoch, need:
- Median results - reveals
- Randoms - reveals
- Finalizations and signatures - rewards
- Penalisations - missed reveals, needs commits for missed reveals
- Reward offers

Track all transactions up to finalization for each price epoch.
Once finalized, calculate rewards. Merge into cumulative ones.

On reward epoch x + 1, vote for merkle root of all rewards for x.

Claims should be done for last price epoch of x.

*/

export class RewardManager {
  private readonly logger = getLogger(RewardManager.name);
  private readonly indexer: BlockIndexer;

  private voterAccount: Account;
  private voterAdress: string;

  constructor(private client: FTSOClient, private voterKey: string, private web3: Web3) {
    this.indexer = client.index as BlockIndexer;
    this.voterAccount = getAccount(this.web3, this.voterKey);
    this.voterAdress = this.voterAccount.address;
  }

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
    // const startPriceEpoch = this.client.epochs.firstPriceEpochForRewardEpoch(previousRewardEpoch);

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

    // Already called in FTSO client:
    // this.indexer.on(Received.Offers, (pe: number, o: RewardOffered[]) => this.client.onRewardOffers(pe, o));

    this.indexer.on(Received.Finalize, async (from: string, finalizeData: FinalizeData) => {
      this.logger.info(`[${finalizeData.epochId}] Received finalize from ${from}.`);
      const finalizedEpoch = finalizeData.epochId;
      const rewardEpoch = this.client.epochs.rewardEpochIdForPriceEpochId(finalizedEpoch);

      this.logger.info(`Block number before now: ${getBlockNumberBefore(this.web3, Date.now())}}`);

      if (this.client.rewardEpochOffers.has(rewardEpoch)) {
        this.logger.info(`[${finalizedEpoch}] We have offers for reward epoch ${rewardEpoch}, calculating rewards.`);
        // We have offers, means we started processing for previous reward epoch and should have all
        // required information for calculating rewards.
        if (this.client.rewardCalculator == undefined) this.client.initializeRewardCalculator(rewardEpoch);
        if (!this.client.rewardCalculator.rewardOffers.has(rewardEpoch)) {
          this.client.registerRewardsForRewardEpoch(rewardEpoch);
        }
        await this.client.calculateRewards(finalizedEpoch);

        const cumulativeClaims = this.client.rewardCalculator.getRewardClaimsForPriceEpoch(finalizedEpoch);
        this.logger.info(
          `[${finalizedEpoch}] Calculated ${cumulativeClaims.length} cumulative reward claims for epoch.`
        );

        if (this.isLastPriceEpochInRewardEpoch(finalizedEpoch)) {
          await this.signRewards(cumulativeClaims, rewardEpoch, finalizedEpoch);
        }
      }
    });

    this.indexer.on(Received.RewardFinalize, async (from: string, fd: FinalizeData) => {
      this.logger.info(`[${fd.epochId}] Received reward finalize from ${from}`);
      const rewardClaims = this.client.rewardCalculator.getRewardClaimsForRewardEpoch(fd.epochId);
      const claimable = rewardClaims.filter(claim => !(claim instanceof Penalty));

      const cwp = this.client.generateProofsForClaims(claimable, fd.merkleRoot, this.voterAdress);
      this.logger.info(`[${fd.epochId}] Claiming ${cwp.length} rewards for epoch.`);
      return await this.client.provider.claimRewards(cwp, this.voterAdress);
    });

    // this.indexer.on(Received.Reveal, async (signature: any) => {});

    this.indexer.run(startBlock);
  }

  private async signRewards(cumulativeClaims: RewardClaim[], rewardEpoch: number, priceEpoch: number) {
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

  // private async maybeClaimRewards(previousRewardEpochId: number, currentEpochId: number) {
  //   if (this.isRegisteredForRewardEpoch(previousRewardEpochId) && this.isFirstPriceEpochInRewardEpoch(currentEpochId)) {
  //     this.logger.info(`[${currentEpochId}] Claiming rewards for last reward epoch ${previousRewardEpochId}`);
  //     await this.client.claimRewards(previousRewardEpochId);
  //   }
  // }

  private isFirstPriceEpochInRewardEpoch(priceEpochId: number): boolean {
    const rewardEpoch = this.client.epochs.rewardEpochIdForPriceEpochId(priceEpochId);
    const rewardEpochForPrevious = this.client.epochs.rewardEpochIdForPriceEpochId(priceEpochId - 1);
    return rewardEpochForPrevious != 0 && rewardEpochForPrevious < rewardEpoch;
  }

  private isLastPriceEpochInRewardEpoch(priceEpochId: number): boolean {
    const rewardEpoch = this.client.epochs.rewardEpochIdForPriceEpochId(priceEpochId);
    const rewardEpochForNext = this.client.epochs.rewardEpochIdForPriceEpochId(priceEpochId + 1);
    return rewardEpochForNext > rewardEpoch;
  }

  private currentTimeSec(): number {
    return Math.floor(Date.now() / 1000);
  }
}
