import { DataManager } from "../../../libs/ftso-core/src/DataManager";
import { IndexerClient } from "../../../libs/ftso-core/src/IndexerClient";
import { RewardEpochManager } from "../../../libs/ftso-core/src/RewardEpochManager";
import { EPOCH_SETTINGS } from "../../../libs/ftso-core/src/configs/networks";
import { rewardClaimsForRewardEpoch } from "../../../libs/ftso-core/src/reward-calculation/reward-calculation";
import { Feed } from "../../../libs/ftso-core/src/voting-types";
import { generateVoters } from "../../utils/basic-generators";
import { getDataSource } from "../../utils/db";
import { claimSummary, printSummary, generateRewardEpochDataForRewardCalculation, offersSummary, voterFeedValue, votersSummary } from "../../utils/generators-rewards";
import { defaultSigningPolicyProtocolSettings, realtimeShorterEpochSettings, resetEnvVariables, resetEpochSettings, rewardSettingsForRealtimeShorterEpochSettings, setupEnvVariables, setupEpochSettings } from "../../utils/test-epoch-settings";

// Ensure that the networks are not loaded


describe("generator-rewards", () => {
  before(() => {
    process.env.NETWORK = "from-env";
    setupEpochSettings(realtimeShorterEpochSettings);
    console.log("Epoch settings used");
    console.dir(EPOCH_SETTINGS());
    process.env.RANDOM_GENERATION_BENCHING_WINDOW = "1";
    console.log(`RANDOM_GENERATION_BENCHING_WINDOW = ${process.env.RANDOM_GENERATION_BENCHING_WINDOW }`);
    setupEnvVariables(rewardSettingsForRealtimeShorterEpochSettings);
    console.log("Reward settings used");
    console.dir(rewardSettingsForRealtimeShorterEpochSettings);
  })

  after(() => {
    resetEpochSettings();
    resetEnvVariables();
  })

  it("should generate", async () => {
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
      console
    );
  
    await printSummary(entityManager, voters);
    // const required_history_sec = configService.get<number>("required_indexer_history_time_sec");
    // this.indexer_top_timeout = configService.get<number>("indexer_top_timeout");
    const requiredHistoryTimeSec = 2 * EPOCH_SETTINGS().rewardEpochDurationInVotingEpochs * EPOCH_SETTINGS().votingEpochDurationSeconds;
    const earliestTimestamp = Math.floor(clock.Date.now()/1000) - requiredHistoryTimeSec;
    console.log("Earliest timestamp", earliestTimestamp);
    const indexerClient = new IndexerClient(entityManager, requiredHistoryTimeSec);
    const rewardEpochManger = new RewardEpochManager(indexerClient);
    const dataManager = new DataManager(indexerClient, rewardEpochManger, console);

    const votingRoundId = EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpochId);
    const benchingWindowRevealOffenders = 1;
    const rewardEpoch = await rewardEpochManger.getRewardEpochForVotingEpochId(votingRoundId);    

    const claims = await rewardClaimsForRewardEpoch(
      rewardEpoch.rewardEpochId,
      benchingWindowRevealOffenders,
      dataManager,
      rewardEpochManger
    );

    offersSummary(rewardEpoch.rewardOffers);
    votersSummary(voters);
    claimSummary(voters, claims);
  });

});
