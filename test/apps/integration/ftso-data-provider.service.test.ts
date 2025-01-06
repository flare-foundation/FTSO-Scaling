import { EPOCH_SETTINGS } from "../../../libs/ftso-core/src/constants";

import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import FakeTimers from "@sinonjs/fake-timers";
import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { expect } from "chai";
import { IConfig } from "../../../apps/ftso-data-provider/src/config/configuration";
import { FtsoDataProviderService } from "../../../apps/ftso-data-provider/src/ftso-data-provider.service";
import {
  encodeCommitPayloadMessage,
  encodeRevealPayloadMessage,
} from "../../../apps/ftso-data-provider/src/response-encoders";
import { ContractMethodNames } from "../../../libs/contracts/src/definitions";
import { CommitData } from "../../../libs/ftso-core/src/data/CommitData";
import { unPrefix0x } from "../../../libs/ftso-core/src/utils/encoding";
import { Feed } from "../../../libs/ftso-core/src/voting-types";
import { TestVoter, generateTx, generateVoters } from "../../utils/basic-generators";
import { MockIndexerDB } from "../../utils/db";
import { currentTimeSec, generateRewardEpochEvents, toFeedId } from "../../utils/generators";
import { getTestFile } from "../../utils/getTestFile";
import { generateRandomAddress } from "../../utils/testRandom";
import {AbiCache} from "../../../libs/contracts/src/abi/AbiCache";
import {CONTRACTS} from "../../../libs/contracts/src/constants";

export const testFeeds: Feed[] = [
  { id: toFeedId("BTC/USD", true), decimals: 2 }, // BTC USDT 38,573.26
  { id: toFeedId("ETH/USD", true), decimals: 2 }, // ETH USDT 2,175.12
  { id: toFeedId("FRL/USD", true), decimals: 5 }, // FLR USDT 0.02042
];

describe(`ftso-data-provider.service (${getTestFile(__filename)})`, () => {
  const sampleValues = [38573.26, 2175.12, 0.02042];

  const offerCount = 2;
  const indexerHistorySec = 1000;
  const enc = AbiCache.instance;

  const sigCommit = enc.getFunctionSignature(CONTRACTS.Submission.name, ContractMethodNames.submit1);
  const sigReveal = enc.getFunctionSignature(CONTRACTS.Submission.name, ContractMethodNames.submit2);

  const configValues: IConfig = {
    required_indexer_history_time_sec: indexerHistorySec,
    indexer_top_timeout: 1000,
    voting_round_history_size: 10000,
    value_provider_url: "http://localhost:3000",
    port: -1,
    db_host: "",
    db_name: "",
    db_user: "",
    db_pass: "",
    db_port: -1,
    api_keys: [],
  };

  const configService = new ConfigService(configValues);

  let db: MockIndexerDB;
  let clock: FakeTimers.InstalledClock;
  let mock: MockAdapter;

  before(async () => {
    // Disable NestJS logging
    Logger.overrideLogger(false);
  });

  after(async () => {
    // Re-enable NestJS logging
    Logger.overrideLogger(new Logger());
  });

  beforeEach(async () => {
    db = await MockIndexerDB.create();
    clock = FakeTimers.install({ now: EPOCH_SETTINGS().expectedRewardEpochStartTimeSec(0) * 1000 });
    mock = new MockAdapter(axios);
  });

  afterEach(async () => {
    await db.close();
    clock.uninstall();
    mock.restore();
  });

  it("should return correct reveal data", async () => {
    const voters: TestVoter[] = generateVoters(1);
    const rewardEpochId = 1;
    await setUpRewardEpoch(rewardEpochId, voters);

    mock.onPost(/feed-values/).reply(200, {
      votingRoundId: 1,
      data: testFeeds.map((_, id) => ({ value: sampleValues[id] })),
    });

    const service = new FtsoDataProviderService(db.em, configService);

    const submissionAddress = generateRandomAddress();
    const votingRound = EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpochId);

    const commit = (await service.getCommitData(votingRound, submissionAddress)).payload;

    const reveal = (await service.getRevealData(votingRound, submissionAddress)).payload;

    const expectedCommit = CommitData.hashForCommit(
      submissionAddress,
      votingRound,
      reveal.random,
      reveal.encodedValues
    );
    expect(commit.commitHash).to.be.equal(expectedCommit);
  });

  it("should compute results - multiple voters, same value", async () => {
    const voters: TestVoter[] = generateVoters(10);
    const rewardEpochId = 1;
    await setUpRewardEpoch(rewardEpochId, voters);

    // All voters return the same values at the moment
    mock.onPost(/feed-values/).reply(200, {
      votingRoundId: 1,
      data: testFeeds.map((_, id) => ({ value: sampleValues[id] })),
    });

    const services = voters.map(() => new FtsoDataProviderService(db.em, configService));
    const votingRound = EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpochId);

    clock.tick(1000);

    for (let i = 0; i < voters.length; i++) {
      const encodedCommit = encodeCommitPayloadMessage(
        await services[i].getCommitData(votingRound, voters[i].submitAddress)
      );
      const commitPayload = sigCommit + unPrefix0x(encodedCommit);
      const commitTx = generateTx(
        voters[i].submitAddress,
        CONTRACTS.Submission.address,
        sigCommit,
        1,
        currentTimeSec(),
        commitPayload
      );
      await db.addTransaction([commitTx]);
    }

    clock.tick(EPOCH_SETTINGS().votingEpochDurationSeconds * 1000);

    for (let i = 0; i < voters.length; i++) {
      const encodedReveal = encodeRevealPayloadMessage(
        await services[i].getRevealData(votingRound, voters[i].submitAddress)
      );
      const revealPayload = sigReveal + unPrefix0x(encodedReveal);
      const revealTx = generateTx(
        voters[i].submitAddress,
        CONTRACTS.Submission.address,
        sigReveal,
        2,
        currentTimeSec(),
        revealPayload
      );
      await db.addTransaction([revealTx]);
    }

    clock.tick(EPOCH_SETTINGS().revealDeadlineSeconds * 1000 + 1);

    await db.syncTimeToNow();

    const mRoots = new Set<string>();
    for (let i = 0; i < voters.length; i++) {
      const result = await services[i].getResultData(votingRound);
      expect(result.votingRoundId).to.be.equal(votingRound);
      expect(result.isSecureRandom).to.be.equal(true);
      mRoots.add(result.merkleRoot);

      const fullMerkleTree = await services[i].getFullMerkleTree(votingRound);
      expect(fullMerkleTree.merkleRoot).to.be.equal(result.merkleRoot);
      expect(fullMerkleTree.isSecureRandom).to.be.equal(true);
    }
    expect(mRoots.size).to.be.equal(1);
  });

  describe("benching", () => {
    it("random should be secure with no missed reveals", async () => {
      await runVotingRounds(10, 0, true);
    });
    it("random should be secure with minority benched revealers", async () => {
      await runVotingRounds(10, 3, true);
    });
    it("random should not be secure with less than two non-benched revealers", async () => {
      await runVotingRounds(5, 4, false);
    });

    async function runVotingRounds(votersCount: number, missedRevealers: number, expectedLastSecureRandom: boolean) {
      const voters: TestVoter[] = generateVoters(votersCount);
      const rewardEpochId = 1;
      await setUpRewardEpoch(rewardEpochId, voters);

      mock.onPost(/feed-values/).reply(200, {
        votingRoundId: 1,
        data: testFeeds.map((_, id) => ({ value: sampleValues[id] })),
      });
      mock.onPost(/feed-values/).reply(200, {
        votingRoundId: 2,
        data: testFeeds.map((_, id) => ({ value: sampleValues[id] })),
      });

      const services = voters.map(() => new FtsoDataProviderService(db.em, configService));
      const votingRound = EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpochId);

      clock.tick(1000);

      for (let i = 0; i < voters.length; i++) {
        const encodedCommit = encodeCommitPayloadMessage(
          await services[i].getCommitData(votingRound, voters[i].submitAddress)
        );
        const commitPayload = sigCommit + unPrefix0x(encodedCommit);
        const commitTx = generateTx(
          voters[i].submitAddress,
          CONTRACTS.Submission.address,
          sigCommit,
          1,
          currentTimeSec(),
          commitPayload
        );
        await db.addTransaction([commitTx]);
      }

      clock.tick(EPOCH_SETTINGS().votingEpochDurationSeconds * 1000);

      for (let i = 0; i < voters.length; i++) {
        const encodedCommit = encodeCommitPayloadMessage(
          await services[i].getCommitData(votingRound + 1, voters[i].submitAddress)
        );
        const commitPayload = sigCommit + unPrefix0x(encodedCommit);
        const commitTx = generateTx(
          voters[i].submitAddress,
          CONTRACTS.Submission.address,
          sigCommit,
          1,
          currentTimeSec(),
          commitPayload
        );
        await db.addTransaction([commitTx]);
      }

      for (let i = 0; i < voters.length; i++) {
        if (i < missedRevealers) continue;

        const encodedReveal = encodeRevealPayloadMessage(
          await services[i].getRevealData(votingRound, voters[i].submitAddress)
        );
        const revealPayload = sigReveal + unPrefix0x(encodedReveal);
        const revealTx = generateTx(
          voters[i].submitAddress,
          CONTRACTS.Submission.address,
          sigReveal,
          2,
          currentTimeSec(),
          revealPayload
        );
        await db.addTransaction([revealTx]);
      }

      clock.tick(EPOCH_SETTINGS().revealDeadlineSeconds * 1000 + 1);

      await db.syncTimeToNow();

      const secureRandom = missedRevealers === 0;
      for (let i = 0; i < voters.length; i++) {
        const result = await services[i].getResultData(votingRound);
        expect(result.isSecureRandom).to.be.equal(secureRandom);
      }

      clock.tick(EPOCH_SETTINGS().votingEpochStartMs(votingRound + 2) - clock.now + 1);

      for (let i = 0; i < voters.length; i++) {
        const encodedReveal = encodeRevealPayloadMessage(
          await services[i].getRevealData(votingRound + 1, voters[i].submitAddress)
        );
        const revealPayload = sigReveal + unPrefix0x(encodedReveal);
        const revealTx = generateTx(
          voters[i].submitAddress,
          CONTRACTS.Submission.address,
          sigReveal,
          2,
          currentTimeSec(),
          revealPayload
        );
        await db.addTransaction([revealTx]);
      }

      clock.tick(EPOCH_SETTINGS().revealDeadlineSeconds * 1000 + 1);

      await db.syncTimeToNow();

      for (let i = 0; i < voters.length; i++) {
        const result = await services[i].getResultData(votingRound + 1);
        expect(result.isSecureRandom).to.be.equal(expectedLastSecureRandom);
      }
    }
  });

  async function setUpRewardEpoch(rewardEpochId: number, voters: TestVoter[]) {
    const epochEvents = await generateRewardEpochEvents(EPOCH_SETTINGS(), testFeeds, offerCount, rewardEpochId, voters);

    await db.addEvent(epochEvents);

    clock.setSystemTime(EPOCH_SETTINGS().expectedRewardEpochStartTimeSec(rewardEpochId) * 1000 + 1);

    await db.syncTimeToNow();
  }
});
