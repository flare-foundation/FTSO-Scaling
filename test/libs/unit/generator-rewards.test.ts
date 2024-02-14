import { expect } from "chai";
import { DataManager } from "../../../libs/ftso-core/src/DataManager";
import { IndexerClient } from "../../../libs/ftso-core/src/IndexerClient";
import { RewardEpochManager } from "../../../libs/ftso-core/src/RewardEpochManager";
import { EPOCH_SETTINGS } from "../../../libs/ftso-core/src/configs/networks";
import { rewardClaimsForRewardEpoch } from "../../../libs/ftso-core/src/reward-calculation/reward-calculation";
import { emptyLogger } from "../../../libs/ftso-core/src/utils/ILogger";
import { ClaimType, RewardClaim } from "../../../libs/ftso-core/src/utils/RewardClaim";
import { Feed } from "../../../libs/ftso-core/src/voting-types";
import { generateVoters } from "../../utils/basic-generators";
import { getDataSource } from "../../utils/db";
import { generateRewardEpochDataForRewardCalculation, happyRewardDataSimulationScenario, voterFeedValue } from "../../utils/generators-rewards";
import { getTestFile } from "../../utils/getTestFile";
import { printSummary } from "../../utils/indexer-db-summary";
import { claimSummary, offersSummary, votersSummary } from "../../utils/reward-claim-summaries";
import {
  defaultSigningPolicyProtocolSettings,
  realtimeShorterEpochSettings,
  resetEnvVariables,
  resetEpochSettings,
  rewardSettingsForRealtimeShorterEpochSettings,
  setupEnvVariables,
  setupEpochSettings,
} from "../../utils/test-epoch-settings";

// Ensure that the networks are not loaded

// const logger = console;
const logger = emptyLogger;


describe(`generator-rewards, ${getTestFile(__filename)}`, () => {
  before(() => {
    process.env.NETWORK = "from-env";
    setupEpochSettings(realtimeShorterEpochSettings);
    logger.log("Epoch settings used");
    logger.dir(EPOCH_SETTINGS());
    process.env.RANDOM_GENERATION_BENCHING_WINDOW = "1";
    logger.log(`RANDOM_GENERATION_BENCHING_WINDOW = ${process.env.RANDOM_GENERATION_BENCHING_WINDOW }`);
    setupEnvVariables(rewardSettingsForRealtimeShorterEpochSettings);
    logger.log("Reward settings used");
    logger.dir(rewardSettingsForRealtimeShorterEpochSettings);
  })

  after(() => {
    resetEpochSettings();
    resetEnvVariables();
  });

  it("should happy path scenario work", async () => {
    const numberOfVoters = 10;
    const feeds: Feed[] = [
      { name: "0x4254430055534454", decimals: 2 }, // BTC USDT 38,573.26
      { name: "0x4554480055534454", decimals: 2 }, // ETH USDT 2,175.12
      { name: "0x464c520055534454", decimals: 5 }, // FLR USDT 0.02042
    ];
      
    const voters = generateVoters(numberOfVoters)
    const dataSource = await getDataSource(false);
    const entityManager = dataSource.createEntityManager();
    const offerAmount = BigInt(1000000);
    const rewardEpochId = 1;

    const clock = await generateRewardEpochDataForRewardCalculation(
      entityManager,
      defaultSigningPolicyProtocolSettings,
      feeds,
      offerAmount,
      rewardEpochId,
      voters,
      voterFeedValue,
      happyRewardDataSimulationScenario,
      logger
    );
    await printSummary(entityManager, voters, undefined, logger);
    const requiredHistoryTimeSec = 2 * EPOCH_SETTINGS().rewardEpochDurationInVotingEpochs * EPOCH_SETTINGS().votingEpochDurationSeconds;
    const earliestTimestamp = Math.floor(clock.Date.now()/1000) - requiredHistoryTimeSec;
    logger.log("Earliest timestamp", earliestTimestamp);
    const indexerClient = new IndexerClient(entityManager, requiredHistoryTimeSec);
    const rewardEpochManger = new RewardEpochManager(indexerClient);
    const dataManager = new DataManager(indexerClient, rewardEpochManger, console);

    const votingRoundId = EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpochId);
    const benchingWindowRevealOffenders = 1;
    const rewardEpoch = await rewardEpochManger.getRewardEpochForVotingEpochId(votingRoundId);

    const addLog = true;
    const merge = false;
    const claims = await rewardClaimsForRewardEpoch(
      rewardEpoch.rewardEpochId,
      benchingWindowRevealOffenders,
      dataManager,
      rewardEpochManger,
      merge,
      addLog
    );
    const mergedClaims = RewardClaim.convertToRewardClaims(rewardEpoch.rewardEpochId, RewardClaim.merge(claims));
    offersSummary(rewardEpoch.rewardOffers, logger);
    votersSummary(voters, logger);
    claimSummary(voters, mergedClaims, logger);
    expect(claims.length).to.equal(960);
    expect(mergedClaims.length).to.equal(40);
    expect((claims as any).filter(c => c.claimType === ClaimType.DIRECT).length).to.equal(0);
    expect((claims as any).filter(c => c.claimType === ClaimType.FEE).length).to.equal(315);
    expect((claims as any).filter(c => c.claimType === ClaimType.WNAT).length).to.equal(315);
    expect((claims as any).filter(c => c.claimType === ClaimType.MIRROR).length).to.equal(330);
    expect((claims as any).filter(c => c.claimType === ClaimType.CCHAIN).length).to.equal(0);

    expect((mergedClaims as any).filter(c => c.claimType === ClaimType.DIRECT).length).to.equal(0);
    expect((mergedClaims as any).filter(c => c.claimType === ClaimType.FEE).length).to.equal(10);
    expect((mergedClaims as any).filter(c => c.claimType === ClaimType.WNAT).length).to.equal(10);
    expect((mergedClaims as any).filter(c => c.claimType === ClaimType.MIRROR).length).to.equal(20);
    expect((mergedClaims as any).filter(c => c.claimType === ClaimType.CCHAIN).length).to.equal(0);

  });
});
