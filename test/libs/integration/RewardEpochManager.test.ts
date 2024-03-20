import {
  EPOCH_SETTINGS,
  FIRST_DATABASE_INDEX_STATE,
  LAST_DATABASE_INDEX_STATE,
} from "../../../libs/ftso-core/src/configs/networks";
import { IndexerClient } from "../../../libs/ftso-core/src/IndexerClient";
import { RewardEpochManager } from "../../../libs/ftso-core/src/RewardEpochManager";

import FakeTimers from "@sinonjs/fake-timers";
import { generateRewardEpochEvents } from "../../utils/generators";
import { getDataSource } from "../../utils/db";
import { DataSource, EntityManager } from "typeorm";
import { expect } from "chai";
import { Feed } from "../../../libs/ftso-core/src/voting-types";
import { generateState, generateVoters, TestVoter } from "../../utils/basic-generators";

describe("RewardEpochManager", () => {
  const feeds: Feed[] = [
    { id: "4254430055534454", decimals: 2 }, // BTC USDT 38,573.26
    { id: "4554480055534454", decimals: 2 }, // ETH USDT 2,175.12
    { id: "464c520055534454", decimals: 5 }, // FLR USDT 0.02042
  ];
  const voters: TestVoter[] = generateVoters(4);
  const offerCount = 2;
  const indexerHistorySec = 1000;

  let ds: DataSource;
  let em: EntityManager;
  let clock: FakeTimers.InstalledClock;

  beforeEach(async () => {
    ds = await getDataSource(false);
    em = ds.createEntityManager();
    clock = FakeTimers.install({ now: EPOCH_SETTINGS().expectedRewardEpochStartTimeSec(0) * 1000 });
  });

  afterEach(async () => {
    await ds.destroy();
    clock.uninstall();
  });

  it("should retrieve correct reward epoch", async () => {
    const rewardEpochId = 1;
    await setUpRewardEpoch(rewardEpochId);

    const epochManager = new RewardEpochManager(new IndexerClient(em, indexerHistorySec, console));
    const votingRound = EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpochId);
    const rewardEpoch = await epochManager.getRewardEpochForVotingEpochId(votingRound);

    expect(rewardEpoch.rewardEpochId).to.be.equal(rewardEpochId);
    expect(rewardEpoch.startVotingRoundId).to.be.equal(votingRound);
    expect(rewardEpoch.orderedVotersSubmitAddresses).to.eql(voters.map(v => v.submitAddress));
  });

  async function setUpRewardEpoch(rewardEpochId: number) {
    const epochEvents = await generateRewardEpochEvents(EPOCH_SETTINGS(), feeds, offerCount, rewardEpochId, voters);
    await em.save(epochEvents);

    const lowerState = generateState(FIRST_DATABASE_INDEX_STATE, 0);
    const upperState = generateState(LAST_DATABASE_INDEX_STATE, 1);
    lowerState.block_timestamp = 0;
    lowerState.index = 0;
    upperState.block_timestamp = epochEvents[epochEvents.length - 1].timestamp + 1;
    upperState.index = 1; // this should be higher.
    await em.save([lowerState, upperState]);

    clock.setSystemTime(EPOCH_SETTINGS().expectedRewardEpochStartTimeSec(rewardEpochId) * 1000);
  }
});
