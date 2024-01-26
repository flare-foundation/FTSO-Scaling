import { Controller, Get, Param, ParseIntPipe } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";

import { BaseRewardingController } from "../common/base-controller";
import { RewardClaimUnit } from "../../dto/reward-claim.dto";
import { FtsoRewardingService } from "../../protocol-services/ftso/ftso-reward.service";

@ApiTags("Flare TSO")
@Controller("ftso/reward-controller")
export class FtsoRewardController extends BaseRewardingController {
  constructor(private readonly rewardingService: FtsoRewardingService) {
    super();
  }

  @Get("calculate-rewards-for-epoch/:rewardEpochId")
  getClaimsForRewardEpoch(@Param("rewardEpochId", ParseIntPipe) rewardEpochId: number): Promise<RewardClaimUnit[]> {
    return this.rewardingService.calculateRewardsForEpoch(rewardEpochId);
  }
}
