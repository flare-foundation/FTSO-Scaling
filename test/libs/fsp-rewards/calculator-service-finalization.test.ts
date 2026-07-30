import { ConfigService } from "@nestjs/config";
import { expect } from "chai";
import { existsSync, rmSync } from "fs";
import path from "path/posix";
import sinon from "sinon";
import { EntityManager } from "typeorm";
import { CalculatorService } from "../../../apps/ftso-reward-calculation-process/src/services/calculator.service";
import { ClaimType, IPartialRewardClaim } from "../../../libs/fsp-rewards/src/utils/RewardClaim";
import {
  BURN_ADDRESS,
  CALCULATIONS_FOLDER,
  FCC_FAR_FUTURE_REWARD_EPOCH,
} from "../../../libs/fsp-rewards/src/constants";
import { serializePartialClaimsForVotingRoundId } from "../../../libs/fsp-rewards/src/utils/stat-info/partial-claims";
import {
  RewardCalculationStatus,
  deserializeRewardEpochCalculationStatus,
  serializeRewardEpochCalculationStatus,
} from "../../../libs/fsp-rewards/src/utils/stat-info/reward-calculation-status";
import { deserializeRewardDistributionData } from "../../../libs/fsp-rewards/src/utils/stat-info/reward-distribution-data";
import {
  RewardEpochInfo,
  serializeRewardEpochInfo,
} from "../../../libs/fsp-rewards/src/utils/stat-info/reward-epoch-info";
import { getTestFile } from "../../utils/getTestFile";

const VOTING_ROUND_ID = 20_000_000;

function calculationService(): CalculatorService {
  const config = new ConfigService({ required_indexer_history_time_sec: 0, indexer_top_timeout: 0 });
  return new CalculatorService({} as EntityManager, config);
}

function prepareEpoch(rewardEpochId: number): string {
  const rewardEpochFolder = path.join(CALCULATIONS_FOLDER(), `${rewardEpochId}`);
  rmSync(rewardEpochFolder, { recursive: true, force: true });

  serializeRewardEpochInfo(rewardEpochId, {
    rewardEpochId,
    signingPolicy: { startVotingRoundId: VOTING_ROUND_ID },
    endVotingRoundId: VOTING_ROUND_ID,
  } as RewardEpochInfo);
  serializeRewardEpochCalculationStatus({
    rewardEpochId,
    startVotingRoundId: VOTING_ROUND_ID,
    endVotingRoundId: VOTING_ROUND_ID,
    calculationStatus: RewardCalculationStatus.IN_PROGRESS,
  });

  const claims: IPartialRewardClaim[] = [
    {
      votingRoundId: VOTING_ROUND_ID,
      beneficiary: BURN_ADDRESS,
      amount: 1n,
      claimType: ClaimType.DIRECT,
    },
  ];
  serializePartialClaimsForVotingRoundId(rewardEpochId, VOTING_ROUND_ID, claims);
  return rewardEpochFolder;
}

describe(`CalculatorService finalization (${getTestFile(__filename)})`, () => {
  const rewardEpochFolders: string[] = [];

  afterEach(() => {
    for (const rewardEpochFolder of rewardEpochFolders.splice(0)) {
      rmSync(rewardEpochFolder, { recursive: true, force: true });
    }
  });

  it("marks an epoch done only after final distribution generation and successful reconciliation", async () => {
    const rewardEpochId = FCC_FAR_FUTURE_REWARD_EPOCH - 1;
    rewardEpochFolders.push(prepareEpoch(rewardEpochId));

    await calculationService().fullRoundAggregateClaims({ rewardEpochId });

    expect(deserializeRewardDistributionData(rewardEpochId).rewardClaims).to.have.length(1);
    expect(deserializeRewardEpochCalculationStatus(rewardEpochId).calculationStatus).to.eq(
      RewardCalculationStatus.DONE
    );
  });

  it("does not mark an epoch done when FCC reconciliation fails", async () => {
    const rewardEpochId = FCC_FAR_FUTURE_REWARD_EPOCH;
    const rewardEpochFolder = prepareEpoch(rewardEpochId);
    rewardEpochFolders.push(rewardEpochFolder);

    let error: Error | undefined;
    try {
      await calculationService().fullRoundAggregateClaims({ rewardEpochId });
    } catch (e) {
      error = e as Error;
    }

    expect(error?.message).to.contain("Reward calculation data for reward epoch");
    expect(deserializeRewardDistributionData(rewardEpochId).rewardClaims).to.have.length(1);
    expect(deserializeRewardEpochCalculationStatus(rewardEpochId).calculationStatus).to.eq(
      RewardCalculationStatus.IN_PROGRESS
    );
    expect(existsSync(path.join(rewardEpochFolder, "reward-distribution-data.json"))).to.eq(true);
  });

  it("rejects legacy incremental calculation at service dispatch", async () => {
    const service = calculationService();
    const incrementalCalculation = sinon.stub(service, "runRewardCalculationIncremental");

    let error: Error | undefined;
    try {
      await service.run({ incrementalCalculation: true });
    } catch (e) {
      error = e as Error;
    }

    expect(error?.message).to.eq("Incremental reward calculation is not supported");
    expect(incrementalCalculation.called).to.eq(false);
  });

  it("rejects the direct legacy incremental service entry point", async () => {
    let error: Error | undefined;
    try {
      await calculationService().runRewardCalculationIncremental({});
    } catch (e) {
      error = e as Error;
    }
    expect(error?.message).to.eq("Incremental reward calculation is not supported");
  });
});
