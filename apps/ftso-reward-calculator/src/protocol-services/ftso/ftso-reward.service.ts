import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EntityManager } from "typeorm";
import { DataManager } from "../../../../../libs/ftso-core/src/DataManager";
import { IndexerClient } from "../../../../../libs/ftso-core/src/IndexerClient";
import { RewardEpochManager } from "../../../../../libs/ftso-core/src/RewardEpochManager";
import { RANDOM_GENERATION_BENCHING_WINDOW } from "../../../../../libs/ftso-core/src/configs/networks";
import { rewardClaimsForRewardEpoch } from "../../../../../libs/ftso-core/src/reward-calculation/reward-calculation";
import { RewardClaimUnit } from "../../dto/reward-claim.dto";
import { BaseRewardingService } from "../common/base.service";

@Injectable()
export class FtsoRewardingService extends BaseRewardingService {
  private readonly logger = new Logger(FtsoRewardingService.name);
  // private readonly epochSettings: EpochSettings;
  private readonly indexerClient: IndexerClient;
  private rewardEpochManger: RewardEpochManager;
  private dataManager: DataManager;

  // Indexer top timeout margin
  private indexer_top_timeout: number;

  constructor(manager: EntityManager, configService: ConfigService) {
    super();
    this.entityManager = manager;
    const required_history_sec = configService.get<number>("required_indexer_history_time_sec");
    this.indexer_top_timeout = configService.get<number>("indexer_top_timeout");
    this.indexerClient = new IndexerClient(manager, required_history_sec, new Logger(IndexerClient.name));
    this.rewardEpochManger = new RewardEpochManager(this.indexerClient);
    this.dataManager = new DataManager(this.indexerClient, this.rewardEpochManger, this.logger);
  }

  /**
   * Returns a list of all (merged) reward claims for the given reward epoch.
   * Calculation can be quite intensive.
   * @param rewardEpochId
   * @returns
   */
  async calculateRewardsForEpoch(rewardEpochId: number): Promise<RewardClaimUnit[]> {
    const mergedClaims = await rewardClaimsForRewardEpoch(
      rewardEpochId,
      RANDOM_GENERATION_BENCHING_WINDOW(),
      this.dataManager,
      this.rewardEpochManger
    );
    return mergedClaims.map(claim => RewardClaimUnit.from(claim));
  }
}
