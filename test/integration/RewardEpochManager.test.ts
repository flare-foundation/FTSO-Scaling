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
    clock = FakeTimers.install({ now: epochSettings.expectedRewardEpochStartTimeSec(0) * 1000 });
  });

  afterEach(async () => {
    ds.destroy();
    clock.uninstall();
  });

  it("should retrieve correct reward epoch", async () => {
    const rewardEpochId = 1;
    await setUpRewardEpoch(rewardEpochId);

    const epochManager = new RewardEpochManager(new IndexerClient(em, indexerHistorySec));
    const votingRound = epochSettings.expectedFirstVotingRoundForRewardEpoch(rewardEpochId);
    const rewardEpoch = await epochManager.getRewardEpoch(votingRound);

    expect(rewardEpoch.rewardEpochId).to.be.equal(rewardEpochId);
    expect(rewardEpoch.startVotingRoundId).to.be.equal(votingRound);
    expect(rewardEpoch.orderedVotersSubmissionAddresses).to.eql(voters.map(v => v.submitAddress));
  });

  async function setUpRewardEpoch(rewardEpochId: number) {
    const epochEvents = await generateRewardEpochEvents(epochSettings, feeds, offerCount, rewardEpochId, voters);
    await em.save(epochEvents);

    const lowerState = generateState(FIRST_DATABASE_INDEX_STATE, 0);
    const upperState = generateState(LAST_DATABASE_INDEX_STATE, 1);
    lowerState.block_timestamp = 0;
    upperState.block_timestamp = epochEvents[epochEvents.length - 1].timestamp + 1;
    await em.save([lowerState, upperState]);

    clock.setSystemTime(epochSettings.expectedRewardEpochStartTimeSec(rewardEpochId) * 1000);
  }
});
