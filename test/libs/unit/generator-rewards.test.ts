import { DataManager } from "../../../libs/ftso-core/src/DataManager";
import { IndexerClient } from "../../../libs/ftso-core/src/IndexerClient";
import { RewardEpochManager } from "../../../libs/ftso-core/src/RewardEpochManager";
import { EPOCH_SETTINGS } from "../../../libs/ftso-core/src/configs/networks";
import { rewardClaimsForRewardEpoch } from "../../../libs/ftso-core/src/reward-calculation/reward-calculation";
import { Feed } from "../../../libs/ftso-core/src/voting-types";
import { generateVoters } from "../../utils/basic-generators";
import { getDataSource } from "../../utils/db";
import { extractIndexerToCSV, generateRewardEpochDataForRewardCalculation, voterFeedValue } from "../../utils/generators-rewards";
import { defaultSigningPolicyProtocolSettings, realtimeShorterEpochSettings, resetEpochSettings, setupEpochSettings } from "../../utils/test-epoch-settings";

// Ensure that the networks are not loaded


describe.only("generator-rewards", () => {
  before(() => {
    process.env.NETWORK = "from-env";
    setupEpochSettings(realtimeShorterEpochSettings);
    console.log("Epoch settings used");
    console.dir(EPOCH_SETTINGS());
    process.env.RANDOM_GENERATION_BENCHING_WINDOW = "1";
    console.log(`RANDOM_GENERATION_BENCHING_WINDOW = ${process.env.RANDOM_GENERATION_BENCHING_WINDOW }`);
  })

  after(() => {
    resetEpochSettings();
  })

  it("should generate", async () => {
    const numberOfVoters = 4;
    const feeds: Feed[] = [
      { name: "0x4254430055534454", decimals: 2 }, // BTC USDT 38,573.26
      { name: "0x4554480055534454", decimals: 2 }, // ETH USDT 2,175.12
      { name: "0x464c520055534454", decimals: 5 }, // FLR USDT 0.02042
    ];
  
    const voters = generateVoters(numberOfVoters)
    const dataSource = await getDataSource(false);
    const entityManager = dataSource.createEntityManager();
    const offerAmount = BigInt(1000);
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
  
    await extractIndexerToCSV(entityManager, voters, "test.csv");
    // const required_history_sec = configService.get<number>("required_indexer_history_time_sec");
    // this.indexer_top_timeout = configService.get<number>("indexer_top_timeout");
    const requiredHistoryTimeSec = 2 * EPOCH_SETTINGS().rewardEpochDurationInVotingEpochs * EPOCH_SETTINGS().votingEpochDurationSeconds;
    const indexerClient = new IndexerClient(entityManager, requiredHistoryTimeSec);
    const rewardEpochManger = new RewardEpochManager(indexerClient);
    const dataManager = new DataManager(indexerClient, rewardEpochManger, console);

    const votingRoundId = 1020;
    const benchingWindowRevealOffenders = 1;
    const rewardEpoch = await rewardEpochManger.getRewardEpochForVotingEpochId(votingRoundId);
    const data = await dataManager.getDataForRewardCalculation(votingRoundId, benchingWindowRevealOffenders, rewardEpoch);
    

    const claims = await rewardClaimsForRewardEpoch(
      rewardEpoch.rewardEpochId,
      benchingWindowRevealOffenders,
      dataManager,
      rewardEpochManger
    );

    console.dir(claims, { depth: 10 });
  
  });

});
