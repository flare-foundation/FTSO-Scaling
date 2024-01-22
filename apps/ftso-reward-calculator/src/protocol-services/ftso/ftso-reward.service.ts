import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EntityManager } from "typeorm";
import { IndexerClient } from "../../../../../libs/ftso-core/src/IndexerClient";
import { EpochSettings } from "../../../../../libs/ftso-core/src/utils/EpochSettings";
import { RewardClaim } from "../../../../../libs/ftso-core/src/voting-types";
import { RewardClaimTypeEnum, RewardClaimUnit } from "../../dto/reward-claim.dto";
import { BaseRewardingService } from "../common/base.service";

@Injectable()
export class FtsoRewardingService extends BaseRewardingService {
  private readonly logger = new Logger(FtsoRewardingService.name);
  private readonly epochSettings: EpochSettings;
  private readonly indexerClient: IndexerClient;

  constructor(manager: EntityManager, configService: ConfigService) {
    super();
    this.entityManager = manager;
    // TODO: Get real epoch setting values from smart contracts
    this.epochSettings = configService.get<EpochSettings>("epochSettings");
    // this.indexerClient = new IndexerClient(manager, this.epochSettings);
  }

  async calculateRewardsForEpoch(rewardEpochId: number): Promise<RewardClaimUnit[]> {
    return [];
    /*
    const firstPriceEpoch = this.epochSettings.firstPriceEpochForRewardEpoch(rewardEpochId);
    const lastPriceEpoch = this.epochSettings.lastPriceEpochForRewardEpoch(rewardEpochId);
    
    this.logger.log(
      `Calcualting rewards for reward epoch ${rewardEpochId}, first price epoch: ${firstPriceEpoch}, start time: ${this.epochSettings.priceEpochStartTimeSec(
        firstPriceEpoch
      )}  last price epoch ${lastPriceEpoch}, next epoch start time: ${this.epochSettings.priceEpochStartTimeSec(
        lastPriceEpoch + 1
      )}.`
    );

    const offers = await this.indexerClient.getRewardOffers(rewardEpochId);
    if (offers.length === 0) {
      this.logger.error("No offers found for reward epoch: ", rewardEpochId);
    }

    const allClaims = new Array<RewardClaim>();

    // TODO: Calculate rewards for price epochs in parallel
    for (let priceEpoch = firstPriceEpoch; priceEpoch <= lastPriceEpoch; priceEpoch++) {
      this.logger.log(`Querying commits for reward epoch, first price epoch: ${priceEpoch}`);
      const commits = await this.indexerClient.queryCommits(priceEpoch);
      // TODO: Replace this with a real voter weights when available
      const fakeWeights = new Map<string, BN>();
      for (const commit of commits) {
        fakeWeights.set(commit[0], new BN(1));
      }

      const reveals = await this.indexerClient.queryReveals(priceEpoch);
      // Using signatures and finalization from the previous price epoch
      const signatures = await this.indexerClient.querySignatures(priceEpoch - 1);
      const finalization = await this.indexerClient.queryFinalize(priceEpoch - 1);

      this.logger.log(`Sigs: ${signatures.size}, Finalization: ${finalization ? finalization[0].epochId : 0}`);

      const priceEpochClaims = await calculateRewards(
        priceEpoch,
        commits,
        reveals,
        signatures,
        finalization,
        offers,
        fakeWeights,
        this.epochSettings
      );
      allClaims.push(...priceEpochClaims);
      this.logger.log(`Calculated rewards for price epoch ${priceEpoch}: ${JSON.stringify(priceEpochClaims.length)}`);
    }

    const merged = mergeClaims(0, allClaims);
    return merged.map(claim => this.toUnit(claim, rewardEpochId));
    */
  }

  // TODO: Replace all uses of RewardClaim with RewardClaimUnit
  toUnit(claim: RewardClaim, rewardEpochId: number): RewardClaimUnit {
    const unit: RewardClaimUnit = {
      amount: claim.amount.toString(),
      beneficiary: claim.beneficiary,
      type: claim.isFixedClaim ? RewardClaimTypeEnum.DIRECT : RewardClaimTypeEnum.WFLR,
      rewardEpochId: rewardEpochId,
    };

    return unit;
  }
}
