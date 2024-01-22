import {
  EPOCH_SETTINGS,
  FIRST_DATABASE_INDEX_STATE,
  LAST_DATABASE_INDEX_STATE,
} from "../../libs/ftso-core/src/configs/networks";
import { IndexerClient } from "../../libs/ftso-core/src/IndexerClient";
import { RewardEpochManager } from "../../libs/ftso-core/src/RewardEpochManager";

import FakeTimers from "@sinonjs/fake-timers";
import { generateVoters, generateRewardEpochEvents, generateState, TestVoter } from "../utils/generators";
import { getDataSource } from "../utils/db";
import { DataSource, EntityManager } from "typeorm";
import { expect } from "chai";

describe("RewardEpochManager", () => {
  const feeds = ["0000000000000000", "0000000000000001"];
  const voters: TestVoter[] = generateVoters(4);
  const offerCount = 2;
  const epochSettings = EPOCH_SETTINGS;
  const indexerHistorySec = 1000;

  let ds: DataSource;
  let em: EntityManager;
  let clock: FakeTimers.InstalledClock;

  beforeEach(async () => {
    ds = await getDataSource(false);
    em = ds.createEntityManager();
  });

  afterEach(async () => {
    ds.destroy();
    clock.uninstall();
  });

  it("should retrieve correct reward epoch", async () => {
    await setUpRewardEpoch(1);

    const epochManager = new RewardEpochManager(new IndexerClient(em, indexerHistorySec));
    const rewardEpoch = await epochManager.getRewardEpoch(1000);
    console.log(voters.map(v => v.submitAddress));

    expect(rewardEpoch.orderedVotersSubmissionAddresses).to.eql(voters.map(v => v.submitAddress));
  });

  async function setUpRewardEpoch(rewardEpochId: number) {
    clock = FakeTimers.install({ now: epochSettings.expectedRewardEpochStartTimeSec(rewardEpochId - 1) * 1000 });

    const reEvents = await generateRewardEpochEvents(epochSettings, feeds, offerCount, rewardEpochId - 1, voters);
    await em.save(reEvents);

    const lowerState = generateState(FIRST_DATABASE_INDEX_STATE, 0);
    const upperState = generateState(LAST_DATABASE_INDEX_STATE, 1);
    lowerState.block_timestamp = 0;
    upperState.block_timestamp = reEvents[reEvents.length - 1].timestamp + 1;
    await em.save([lowerState, upperState]);

    clock.setSystemTime(EPOCH_SETTINGS.expectedRewardEpochStartTimeSec(rewardEpochId) * 1000);
  }
});
