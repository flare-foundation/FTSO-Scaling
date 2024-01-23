import {
  EPOCH_SETTINGS,
  FIRST_DATABASE_INDEX_STATE,
  LAST_DATABASE_INDEX_STATE,
} from "../../../libs/ftso-core/src/configs/networks";

import FakeTimers from "@sinonjs/fake-timers";
import {
  generateVoters,
  generateRewardEpochEvents,
  generateState,
  TestVoter,
  generateRandomAddress,
} from "../../utils/generators";
import { getDataSource } from "../../utils/db";
import { DataSource, EntityManager } from "typeorm";
import { expect } from "chai";
import { ConfigService } from "@nestjs/config";
import { FtsoCalculatorService } from "../../../apps/ftso-data-provider/src/ftso-calculator.service";
import MockAdapter from "axios-mock-adapter";
import axios from "axios";
import { PayloadMessage } from "../../../libs/ftso-core/src/utils/PayloadMessage";
import { RevealData } from "../../../libs/ftso-core/src/utils/RevealData";
import { CommitData } from "../../../libs/ftso-core/src/utils/CommitData";
import { Feed } from "../../../libs/ftso-core/src/voting-types";

describe("ftso-calculator.service", () => {
  const feeds: Feed[] = [
    { name: "0000000000000000", decimals: 1 },
    { name: "0000000000000001", decimals: 1 },
  ];
  const voterCount = 4;
  const voters: TestVoter[] = generateVoters(voterCount);
  const offerCount = 2;
  const epochSettings = EPOCH_SETTINGS;
  const indexerHistorySec = 1000;

  const configService = new ConfigService({
    epochSettings: epochSettings,
    required_indexer_history_time_sec: indexerHistorySec,
    indexer_top_timeout: 1000,
    price_provider_url: "http://localhost:3000",
  });

  let ds: DataSource;
  let em: EntityManager;
  let clock: FakeTimers.InstalledClock;
  let mock: MockAdapter;

  beforeEach(async () => {
    ds = await getDataSource(false);
    em = ds.createEntityManager();
    clock = FakeTimers.install({ now: epochSettings.expectedRewardEpochStartTimeSec(0) * 1000 });
    mock = new MockAdapter(axios);
  });

  afterEach(async () => {
    ds.destroy();
    clock.uninstall();
    mock.restore();
  });

  it.only("should return correct reveal data", async () => {
    const rewardEpochId = 1;
    await setUpRewardEpoch(rewardEpochId);

    mock.onPost(/preparePriceFeeds/).reply(200, {
      votingRoundId: 1,
      feedPriceData: feeds.map(f => ({ feed: f.name, price: 1 })),
    });

    const service = new FtsoCalculatorService(em, configService);

    const submissionAddress = generateRandomAddress();
    const votingRound = epochSettings.expectedFirstVotingRoundForRewardEpoch(rewardEpochId);

    const encodedCommit = await service.getEncodedCommitData(votingRound, submissionAddress);
    const commit = CommitData.decode(PayloadMessage.decode(encodedCommit)[0].payload);

    const encodedReveal = await service.getEncodedRevealData(votingRound);
    const reveal = RevealData.decode(PayloadMessage.decode(encodedReveal)[0].payload, feeds);

    const expectedCommit = CommitData.hashForCommit(submissionAddress, reveal.random, reveal.encodedValues);
    expect(commit.commitHash).to.be.equal(expectedCommit);
  });

  async function setUpRewardEpoch(rewardEpochId: number) {
    const epochEvents = await generateRewardEpochEvents(
      epochSettings,
      feeds.map(f => f.name),
      offerCount,
      rewardEpochId,
      voters
    );
    await em.save(epochEvents);

    const lowerState = generateState(FIRST_DATABASE_INDEX_STATE, 0);
    const upperState = generateState(LAST_DATABASE_INDEX_STATE, 1);
    lowerState.block_timestamp = 0;
    upperState.block_timestamp = epochEvents[epochEvents.length - 1].timestamp + 1;
    await em.save([lowerState, upperState]);

    clock.setSystemTime(epochSettings.expectedRewardEpochStartTimeSec(rewardEpochId) * 1000);
  }
});
