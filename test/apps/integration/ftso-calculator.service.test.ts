import {
  CONTRACTS,
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
  generateTx,
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
import { EncodingUtils, unPrefix0x } from "../../../libs/ftso-core/src/utils/EncodingUtils";
import { TLPEvents, TLPState, TLPTransaction } from "../../../libs/ftso-core/src/orm/entities";

describe("ftso-calculator.service", () => {
  const feeds: Feed[] = [
    { name: "0000000000000000", decimals: 1 },
    { name: "0000000000000001", decimals: 1 },
  ];
  const voterCount = 1;
  const voters: TestVoter[] = generateVoters(voterCount);
  const offerCount = 2;
  const epochSettings = EPOCH_SETTINGS;
  const indexerHistorySec = 1000;
  const enc = EncodingUtils.instance;

  const sigCommit = enc.getFunctionSignature(CONTRACTS.Submission.name, "submit1");
  const sigReveal = enc.getFunctionSignature(CONTRACTS.Submission.name, "submit2");

  const configService = new ConfigService({
    epochSettings: epochSettings,
    required_indexer_history_time_sec: indexerHistorySec,
    indexer_top_timeout: 1000,
    price_provider_url: "http://localhost:3000",
  });

  let db: MockDB;

  let clock: FakeTimers.InstalledClock;
  let mock: MockAdapter;

  beforeEach(async () => {
    db = await MockDB.create();
    clock = FakeTimers.install({ now: epochSettings.expectedRewardEpochStartTimeSec(0) * 1000 });
    mock = new MockAdapter(axios);
  });

  afterEach(async () => {
    db.close();
    clock.uninstall();
    mock.restore();
  });

  it("should return correct reveal data", async () => {
    const rewardEpochId = 1;
    await setUpRewardEpoch(rewardEpochId);

    mock.onPost(/preparePriceFeeds/).reply(200, {
      votingRoundId: 1,
      feedPriceData: feeds.map(f => ({ feed: f.name, price: 1 })),
    });

    const service = new FtsoCalculatorService(db.em, configService);

    const submissionAddress = generateRandomAddress();
    const votingRound = epochSettings.expectedFirstVotingRoundForRewardEpoch(rewardEpochId);

    const encodedCommit = await service.getEncodedCommitData(votingRound, submissionAddress);
    const commit = CommitData.decode(PayloadMessage.decode(encodedCommit)[0].payload);

    const encodedReveal = await service.getEncodedRevealData(votingRound);
    const reveal = RevealData.decode(PayloadMessage.decode(encodedReveal)[0].payload, feeds);

    const expectedCommit = CommitData.hashForCommit(submissionAddress, reveal.random, reveal.encodedValues);
    expect(commit.commitHash).to.be.equal(expectedCommit);
  });

  it.skip("should compute results", async () => {
    const rewardEpochId = 1;
    await setUpRewardEpoch(rewardEpochId);

    const res = await db.em.find(TLPState);
    console.log(res);

    mock.onPost(/preparePriceFeeds/).reply(200, {
      votingRoundId: 1,
      feedPriceData: feeds.map(f => ({ feed: f.name, price: 1 })),
    });

    const service = new FtsoCalculatorService(db.em, configService);

    const submissionAddress = voters[0].submitAddress;
    const votingRound = epochSettings.expectedFirstVotingRoundForRewardEpoch(rewardEpochId);
    const votingRoundBasedOnTime = epochSettings.votingEpochForTimeSec(Date.now() / 1000);
    console.log(`First voting round ${votingRound}, based on time curr: ${votingRoundBasedOnTime}`);

    const encodedCommit = await service.getEncodedCommitData(votingRound, submissionAddress);
    const commit = CommitData.decode(PayloadMessage.decode(encodedCommit)[0].payload);

    const encodedReveal = await service.getEncodedRevealData(votingRound);
    const reveal = RevealData.decode(PayloadMessage.decode(encodedReveal)[0].payload, feeds);

    clock.tick(1000);

    const payload = sigCommit + unPrefix0x(encodedCommit);
    const tx = generateTx(submissionAddress, CONTRACTS.Submission.address, sigCommit, 1, Date.now() / 1000, payload);
    console.log("Recording commit tx at " + tx.timestamp);
    await db.addTransaction([tx]);

    clock.tick(epochSettings.votingEpochDurationSeconds * 1000);
    console.log("Current voting epoch " + epochSettings.votingEpochForTimeSec(Date.now() / 1000));

    // Commit next
    const payload2 = sigReveal + unPrefix0x(encodedReveal);
    const tx2 = generateTx(submissionAddress, CONTRACTS.Submission.address, sigReveal, 2, Date.now() / 1000, payload2);
    console.log("Recording reveal tx at " + tx2.timestamp);
    await db.addTransaction([tx2]);

    clock.tick(epochSettings.revealDeadlineSeconds * 1000 + 1);

    await db.emptyBlock();

    console.log("Current voting epoch " + epochSettings.votingEpochForTimeSec(Date.now() / 1000));


    const results = await service.getEncodedResultData(votingRound);
  });

  class MockDB {
    constructor(
      private readonly ds: DataSource,
      readonly em: EntityManager,
      private lowerState: TLPState,
      private upperState: TLPState,
      startTimeSec: number = 0
    ) {}

    async addEvent(items: TLPEvents[]) {
      await this.em.save(items);
      await this.updateTime(items);
    }

    async addTransaction(items: TLPTransaction[]) {
      await this.em.save(items);
      await this.updateTime(items);
    }

    private async updateTime(items: any[]) {
      const maxTimestamp = items.reduce((max, i: any) => Math.max(max, i.timestamp), 0);
      this.upperState.block_timestamp = maxTimestamp + 1;
      await this.em.save(this.upperState);
    }

    async emptyBlock() {
      this.upperState.block_timestamp = Math.floor(Date.now() / 1000);
      await this.em.save(this.upperState);
    }

    async close() {
      this.ds.destroy();
    }
    static async create(startTimeSec: number = 0) {
      const ds = await getDataSource(false);
      const em = ds.createEntityManager();

      const lowerState = generateState(FIRST_DATABASE_INDEX_STATE, 0);
      const upperState = generateState(LAST_DATABASE_INDEX_STATE, 1);
      lowerState.block_timestamp = startTimeSec;
      upperState.block_timestamp = 0;

      await em.save([lowerState, upperState]);

      const db = new MockDB(ds, em, lowerState, upperState, startTimeSec);
      return db;
    }
  }

  async function setUpRewardEpoch(rewardEpochId: number) {
    const epochEvents = await generateRewardEpochEvents(
      epochSettings,
      feeds.map(f => f.name),
      offerCount,
      rewardEpochId,
      voters
    );

    await db.addEvent(epochEvents);

    clock.setSystemTime(epochSettings.expectedRewardEpochStartTimeSec(rewardEpochId) * 1000 + 1);

    await db.emptyBlock();
  }
});
