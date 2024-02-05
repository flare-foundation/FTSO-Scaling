import { defaultSigningPolicyProtocolSettings, realtimeShorterEpochSettings, resetEpochSettings, setupEpochSettings } from "../../utils/test-epoch-settings";
import FakeTimers from "@sinonjs/fake-timers";
import { Feed } from "../../../libs/ftso-core/src/voting-types";
import { generateVoters } from "../../utils/basic-generators";
import { getDataSource } from "../../utils/db";
import { extractIndexerToCSV, generateRewardEpochDataForRewardCalculation, voterFeedValue } from "../../utils/generators-rewards";
import { EPOCH_SETTINGS } from "../../../libs/ftso-core/src/configs/networks";

// Ensure that the networks are not loaded


describe("generator-rewards", () => {
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
  
    await generateRewardEpochDataForRewardCalculation(
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
  
  });

});
