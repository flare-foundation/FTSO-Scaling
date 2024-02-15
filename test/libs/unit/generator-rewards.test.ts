import FakeTimers from "@sinonjs/fake-timers";
import { expect } from "chai";
import { DataSource, EntityManager } from "typeorm";
import { DataManager } from "../../../libs/ftso-core/src/DataManager";
import { IndexerClient } from "../../../libs/ftso-core/src/IndexerClient";
import { RewardEpochManager } from "../../../libs/ftso-core/src/RewardEpochManager";
import { BURN_ADDRESS, EPOCH_SETTINGS } from "../../../libs/ftso-core/src/configs/networks";
import { rewardClaimsForRewardEpoch } from "../../../libs/ftso-core/src/reward-calculation/reward-calculation";
import { emptyLogger } from "../../../libs/ftso-core/src/utils/ILogger";
import { ClaimType, RewardClaim } from "../../../libs/ftso-core/src/utils/RewardClaim";
import { Feed } from "../../../libs/ftso-core/src/voting-types";
import { TestVoter, generateVoters } from "../../utils/basic-generators";
import { getDataSource } from "../../utils/db";
import { RewardDataSimulationScenario, generateRewardEpochDataForRewardCalculation, happyRewardDataSimulationScenario, voterFeedValue } from "../../utils/generators-rewards";
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

const useEmptyLogger = false;
const logger = useEmptyLogger ? emptyLogger : console;

////////////////
let numberOfVoters: number;
let feeds: Feed[];
let voters: TestVoter[];
let dataSource: DataSource;
let entityManager: EntityManager;
let offerAmount: bigint;
let rewardEpochId: number;
let clock: FakeTimers.InstalledClock;


describe(`generator-rewards, ${getTestFile(__filename)}`, () => {
  before(async () => {
    process.env.NETWORK = "from-env";
    setupEpochSettings(realtimeShorterEpochSettings);
    logger.log("Epoch settings used");
    logger.dir(EPOCH_SETTINGS());
    process.env.RANDOM_GENERATION_BENCHING_WINDOW = "1";
    logger.log(`RANDOM_GENERATION_BENCHING_WINDOW = ${process.env.RANDOM_GENERATION_BENCHING_WINDOW}`);
    setupEnvVariables(rewardSettingsForRealtimeShorterEpochSettings);
    logger.log("Reward settings used");
    logger.dir(rewardSettingsForRealtimeShorterEpochSettings);
    numberOfVoters = 10;
    feeds = [
      { name: "0x4254430055534454", decimals: 2 }, // BTC USDT 38,573.26
      { name: "0x4554480055534454", decimals: 2 }, // ETH USDT 2,175.12
      { name: "0x464c520055534454", decimals: 5 }, // FLR USDT 0.02042
    ];

    voters = generateVoters(numberOfVoters)
    offerAmount = BigInt(1000000);
    rewardEpochId = 1;
  })

  after(() => {
    resetEpochSettings();
    resetEnvVariables();
    clock.uninstall();
  });

  beforeEach(async () => {
    dataSource = await getDataSource(false);
    entityManager = dataSource.createEntityManager();
  });

  afterEach(async () => {
    await dataSource.destroy();
  });


  it("should happy path scenario work", async () => {
    clock = await generateRewardEpochDataForRewardCalculation(
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
    const earliestTimestamp = Math.floor(clock.Date.now() / 1000) - requiredHistoryTimeSec;
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

  it("should first voter never sign and finalize", async () => {
    const scenario: RewardDataSimulationScenario = {
      noSignatureSubmitters: [
        {
          voterIndex: 0,
          votingRoundIds: [1005, 1006, 1007, 1008, 1009]
        }
      ],
      noGracePeriodFinalizers: [
        {
          voterIndex: 0,
          votingRoundIds: [1005, 1006, 1007, 1008, 1009]
        }
      ],
      outsideGracePeriodFinalizers: [],
      doubleSigners: [],
      revealWithholders: [],
      independentFinalizersOutsideGracePeriod: [],
    };
    clock = await generateRewardEpochDataForRewardCalculation(
      entityManager,
      defaultSigningPolicyProtocolSettings,
      feeds,
      offerAmount,
      rewardEpochId,
      voters,
      voterFeedValue,
      scenario,
      logger
    );
    await printSummary(entityManager, voters, undefined, logger);
    const requiredHistoryTimeSec = 2 * EPOCH_SETTINGS().rewardEpochDurationInVotingEpochs * EPOCH_SETTINGS().votingEpochDurationSeconds;
    const earliestTimestamp = Math.floor(clock.Date.now() / 1000) - requiredHistoryTimeSec;
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
  });

  it.only("should last voter get penalized for withholding reveal", async () => {
    const scenario: RewardDataSimulationScenario = {
      noSignatureSubmitters: [],
      noGracePeriodFinalizers: [],
      outsideGracePeriodFinalizers: [],
      doubleSigners: [],
      revealWithholders: [
        {
          voterIndex: 9,
          votingRoundIds: [1005]
        }
      ],
      independentFinalizersOutsideGracePeriod: [],
    };
    clock = await generateRewardEpochDataForRewardCalculation(
      entityManager,
      defaultSigningPolicyProtocolSettings,
      feeds,
      offerAmount,
      rewardEpochId,
      voters,
      voterFeedValue,
      scenario,
      logger
    );
    await printSummary(entityManager, voters, undefined, logger);
    const requiredHistoryTimeSec = 2 * EPOCH_SETTINGS().rewardEpochDurationInVotingEpochs * EPOCH_SETTINGS().votingEpochDurationSeconds;
    const earliestTimestamp = Math.floor(clock.Date.now() / 1000) - requiredHistoryTimeSec;
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
    console.log("BEFORE MERGE");
    const mergedClaims = RewardClaim.convertToRewardClaims(rewardEpoch.rewardEpochId, RewardClaim.merge(claims));
    console.log("AFTER MERGE");
    const mergedWithBurn = RewardClaim.mergeWithBurnClaims(mergedClaims, BURN_ADDRESS);
    console.log("AFTER MERGE WITH BURN");
    // console.dir(mergedWithBurn);
    // offersSummary(rewardEpoch.rewardOffers, logger);
    // votersSummary(voters, logger);
    claimSummary(voters, mergedWithBurn, logger);
  });
});
