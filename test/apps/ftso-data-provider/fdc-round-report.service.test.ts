import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import FakeTimers from "@sinonjs/fake-timers";
import { expect } from "chai";
import { getAddress } from "ethers";
import { IConfig } from "../../../apps/ftso-data-provider/src/config/configuration";
import { FdcRoundReportService } from "../../../apps/ftso-data-provider/src/fdc/fdc-round-report.service";
import { AbiCache } from "../../../libs/contracts/src/abi/AbiCache";
import { CONTRACTS } from "../../../libs/contracts/src/constants";
import { ContractMethodNames } from "../../../libs/contracts/src/definitions";
import { AttestationRequest } from "../../../libs/contracts/src/events/AttestationRequest";
import { EPOCH_SETTINGS } from "../../../libs/ftso-core/src/constants";
import { queryBytesFormat } from "../../../libs/ftso-core/src/IndexerClient";
import { PayloadMessage } from "../../../libs/ftso-core/src/fsp-utils/PayloadMessage";
import { TLPEvents } from "../../../libs/ftso-core/src/orm/entities";
import { unPrefix0x } from "../../../libs/ftso-core/src/utils/encoding";
import { Feed } from "../../../libs/ftso-core/src/voting-types";
import { TestVoter, generateEvent, generateTx, generateVoters } from "../../utils/basic-generators";
import { MockIndexerDB } from "../../utils/db";
import { generateRewardEpochEvents, toFeedId } from "../../utils/generators";
import { getTestFile } from "../../utils/getTestFile";
import { generateRandomAddress } from "../../utils/testRandom";

const testFeeds: Feed[] = [
  { id: toFeedId("BTC/USD", true), decimals: 2 },
  { id: toFeedId("ETH/USD", true), decimals: 2 },
];

const FDC_PROTOCOL_ID = 200;

function encodeBytes32Utf8(value: string): string {
  return Buffer.from(value, "utf8").toString("hex").padEnd(64, "0");
}

function requestData(attestationType: string, sourceId: string, bodySuffixHex: string): string {
  return "0x" + encodeBytes32Utf8(attestationType) + encodeBytes32Utf8(sourceId) + bodySuffixHex;
}

function bitVoteHex(requestCount: number, bits: number): string {
  let bitsHex = bits.toString(16);
  if (bitsHex.length % 2 !== 0) {
    bitsHex = "0" + bitsHex;
  }
  return "0x" + requestCount.toString(16).padStart(4, "0") + (requestCount > 0 ? bitsHex : "");
}

describe(`fdc-round-report.service (${getTestFile(__filename)})`, () => {
  const enc = AbiCache.instance;
  const sigSubmit2 = enc.getFunctionSignature(CONTRACTS.Submission.name, ContractMethodNames.submit2);

  const configValues: IConfig = {
    required_indexer_history_time_sec: 1000,
    indexer_top_timeout: 1000,
    voting_round_history_size: 100,
    value_provider_url: "http://localhost:3000",
    port: -1,
    db_host: "",
    db_name: "",
    db_user: "",
    db_pass: "",
    db_port: -1,
    api_keys: [],
    epoch_result_disk_cache_size: 0,
    fdc_result_cache_size: 0,
  };
  const configService = new ConfigService(configValues);

  let db: MockIndexerDB;
  let clock: FakeTimers.InstalledClock;

  before(() => {
    Logger.overrideLogger(false);
  });

  after(() => {
    Logger.overrideLogger(new Logger());
  });

  beforeEach(async () => {
    db = await MockIndexerDB.create();
    clock = FakeTimers.install({ now: EPOCH_SETTINGS().expectedRewardEpochStartTimeSec(0) * 1000 });
  });

  afterEach(async () => {
    await db.close();
    clock.uninstall();
  });

  async function setUpRewardEpoch(rewardEpochId: number, voters: TestVoter[]) {
    const epochEvents = generateRewardEpochEvents(EPOCH_SETTINGS(), testFeeds, 2, rewardEpochId, voters);
    await db.addEvent(epochEvents);
    clock.setSystemTime(EPOCH_SETTINGS().expectedRewardEpochStartTimeSec(rewardEpochId) * 1000 + 1);
    await db.syncTimeToNow();
  }

  async function addAttestationRequestEvent(
    data: string,
    votingRound: number,
    secondsIntoRound: number,
    blockNumber: number
  ): Promise<TLPEvents> {
    const timestamp = EPOCH_SETTINGS().votingEpochStartSec(votingRound) + secondsIntoRound;
    const event = generateEvent(
      CONTRACTS.FdcHub,
      AttestationRequest.eventName,
      { data, fee: BigInt(1) },
      blockNumber,
      timestamp
    );
    await db.addEvent([event]);
    return event;
  }

  async function addBitVoteTx(
    submitAddress: string,
    votingRound: number,
    payloadHex: string,
    secondsIntoNextRound: number,
    blockNumber: number
  ) {
    const encoded = PayloadMessage.encode({
      protocolId: FDC_PROTOCOL_ID,
      votingRoundId: votingRound,
      payload: payloadHex,
    });
    const timestamp = EPOCH_SETTINGS().votingEpochStartSec(votingRound + 1) + secondsIntoNextRound;
    const tx = generateTx(
      submitAddress,
      CONTRACTS.Submission.address,
      sigSubmit2,
      blockNumber,
      timestamp,
      sigSubmit2 + unPrefix0x(encoded)
    );
    await db.addTransaction([tx]);
  }

  /** Advances time past the bitvote/reveal deadline of votingRound + 1 and syncs the indexer top. */
  async function closeRound(votingRound: number) {
    clock.setSystemTime(
      (EPOCH_SETTINGS().votingEpochStartSec(votingRound + 1) + EPOCH_SETTINGS().revealDeadlineSeconds + 2) * 1000
    );
    await db.syncTimeToNow();
  }

  it("assembles a full round report with dedup, weights, entity order and request ids", async () => {
    const voters = generateVoters(4);
    const rewardEpochId = 1;
    await setUpRewardEpoch(rewardEpochId, voters);
    const votingRound = EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpochId);

    const dataA = requestData("Payment", "XRP", "01");
    const dataB = requestData("AddressValidity", "DOGE", "02");
    const eventA = await addAttestationRequestEvent(dataA, votingRound, 1, 10);
    await addAttestationRequestEvent(dataB, votingRound, 2, 11);
    await addAttestationRequestEvent(dataA, votingRound, 3, 12); // duplicate of A

    // Voters 0-2 accept everything; voter 3 rejects request B (bit 1).
    for (let i = 0; i < 3; i++) {
      await addBitVoteTx(voters[i].submitAddress, votingRound, bitVoteHex(2, 0b11), 1, 20 + i);
    }
    await addBitVoteTx(voters[3].submitAddress, votingRound, bitVoteHex(2, 0b01), 2, 23);

    await closeRound(votingRound);

    const service = new FdcRoundReportService(db.em, configService);
    const report = await service.getFdcRoundReport(votingRound);

    expect(report).to.not.be.undefined;
    expect(report.count).to.be.equal(2);
    expect(report.attestation_requests.length).to.be.equal(2);

    const [entryA, entryB] = report.attestation_requests;
    expect(entryA.count).to.be.equal(2); // duplicate folded in
    expect(entryA.weight).to.be.equal(1); // 4000/4000
    expect(entryA.attestation_request.is_proved).to.be.equal("EXECUTED");
    expect(entryA.attestation_request.attestation_type_source).to.deep.equal({
      attestation_type: "Payment",
      source_id: "XRP",
    });
    expect(entryA.attestation_request.id.block_number).to.be.equal(eventA.block_number);
    expect(entryA.attestation_request.id.log_index).to.be.equal(eventA.log_index);
    expect(entryA.attestation_request.id.timestamp).to.be.equal(eventA.timestamp);
    expect(entryA.attestation_request.id.tx_hash).to.be.null; // generator events carry no linked tx

    expect(entryB.count).to.be.equal(1);
    expect(entryB.weight).to.be.equal(0.75); // 3000/4000
    expect(entryB.attestation_request.is_proved).to.be.equal("EXECUTED"); // 3000 > threshold(1)
    expect(entryB.attestation_request.attestation_type_source).to.deep.equal({
      attestation_type: "AddressValidity",
      source_id: "DOGE",
    });

    // Entities in signing policy (= voters array) order, checksummed identity addresses.
    expect(report.entity_bit_vectors.length).to.be.equal(4);
    for (let i = 0; i < 4; i++) {
      expect(report.entity_bit_vectors[i].entity.identity_address).to.be.equal(getAddress(voters[i].identityAddress));
      expect(report.entity_bit_vectors[i].entity.display_name).to.be.null;
      expect(report.entity_bit_vectors[i].entity.logo_url).to.be.null;
      expect(report.entity_bit_vectors[i].entity.listed).to.be.false;
    }
    expect(report.entity_bit_vectors[0].bit_vector).to.deep.equal([true, true]);
    expect(report.entity_bit_vectors[3].bit_vector).to.deep.equal([true, false]);
  });

  it("counts only the last bitvote per voter and drops invalid or ineligible ones", async () => {
    const voters = generateVoters(3);
    const rewardEpochId = 1;
    await setUpRewardEpoch(rewardEpochId, voters);
    const votingRound = EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpochId);

    await addAttestationRequestEvent(requestData("Payment", "XRP", "aa"), votingRound, 1, 10);

    // Voter 0: first accepts, then re-submits rejecting — the last bitvote must win.
    await addBitVoteTx(voters[0].submitAddress, votingRound, bitVoteHex(1, 0b1), 1, 20);
    await addBitVoteTx(voters[0].submitAddress, votingRound, bitVoteHex(1, 0b0), 3, 21);
    // Voter 1: declared request count mismatch -> shown at declared length, excluded from weights.
    await addBitVoteTx(voters[1].submitAddress, votingRound, bitVoteHex(2, 0b11), 1, 22);
    // Voter 2: bit beyond the declared request count -> dropped.
    await addBitVoteTx(voters[2].submitAddress, votingRound, bitVoteHex(1, 0b10), 1, 23);
    // Unregistered submitter -> ignored.
    await addBitVoteTx(generateRandomAddress(), votingRound, bitVoteHex(1, 0b1), 1, 24);

    await closeRound(votingRound);

    const service = new FdcRoundReportService(db.em, configService);
    const report = await service.getFdcRoundReport(votingRound);

    expect(report.count).to.be.equal(1);
    // Voter 0 with the later (rejecting) bitvote; voter 1 rendered at its declared length of 2.
    expect(report.entity_bit_vectors.length).to.be.equal(2);
    expect(report.entity_bit_vectors[0].entity.identity_address).to.be.equal(getAddress(voters[0].identityAddress));
    expect(report.entity_bit_vectors[0].bit_vector).to.deep.equal([false]);
    expect(report.entity_bit_vectors[1].entity.identity_address).to.be.equal(getAddress(voters[1].identityAddress));
    expect(report.entity_bit_vectors[1].bit_vector).to.deep.equal([true, true]);
    // Voter 1's mismatched bitvote must not count toward support weight.
    expect(report.attestation_requests[0].weight).to.be.equal(0);
    expect(report.attestation_requests[0].attestation_request.is_proved).to.be.equal("UNCONFIRMED");
  });

  it("handles a round with zero attestation requests", async () => {
    const voters = generateVoters(2);
    const rewardEpochId = 1;
    await setUpRewardEpoch(rewardEpochId, voters);
    const votingRound = EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpochId);

    await addBitVoteTx(voters[0].submitAddress, votingRound, bitVoteHex(0, 0), 1, 20);

    await closeRound(votingRound);

    const service = new FdcRoundReportService(db.em, configService);
    const report = await service.getFdcRoundReport(votingRound);

    expect(report.count).to.be.equal(0);
    expect(report.attestation_requests).to.deep.equal([]);
    expect(report.entity_bit_vectors.length).to.be.equal(1);
    expect(report.entity_bit_vectors[0].bit_vector).to.deep.equal([]);
  });

  it("reports requests with no bitvotes as unconfirmed with zero weight", async () => {
    const voters = generateVoters(2);
    const rewardEpochId = 1;
    await setUpRewardEpoch(rewardEpochId, voters);
    const votingRound = EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpochId);

    await addAttestationRequestEvent(requestData("Payment", "XRP", "aa"), votingRound, 1, 10);

    await closeRound(votingRound);

    const service = new FdcRoundReportService(db.em, configService);
    const report = await service.getFdcRoundReport(votingRound);

    expect(report.count).to.be.equal(1);
    expect(report.entity_bit_vectors).to.deep.equal([]);
    expect(report.attestation_requests[0].weight).to.be.equal(0);
    expect(report.attestation_requests[0].attestation_request.is_proved).to.be.equal("UNCONFIRMED");
  });

  it("returns undefined when there is no reward epoch data", async () => {
    clock.setSystemTime(EPOCH_SETTINGS().expectedRewardEpochStartTimeSec(1) * 1000 + 1);
    await db.syncTimeToNow();
    const votingRound = EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(1);

    const service = new FdcRoundReportService(db.em, configService);
    const report = await service.getFdcRoundReport(votingRound);
    expect(report).to.be.undefined;
  });

  it("links tx_hash when the event row has a joined transaction", async () => {
    const voters = generateVoters(1);
    const rewardEpochId = 1;
    await setUpRewardEpoch(rewardEpochId, voters);
    const votingRound = EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpochId);

    const timestamp = EPOCH_SETTINGS().votingEpochStartSec(votingRound) + 1;
    const fdcTx = generateTx(
      generateRandomAddress(),
      CONTRACTS.FdcHub.address,
      "0x12345678",
      10,
      timestamp,
      "0x12345678"
    );
    // generateTx leaves the primary key unset and TypeORM does not read back sqlite's
    // auto-assigned rowid, so the event's FK would be saved as NULL without an explicit id.
    fdcTx.id = 999_001;
    await db.addTransaction([fdcTx]);
    const event = generateEvent(
      CONTRACTS.FdcHub,
      AttestationRequest.eventName,
      { data: requestData("Payment", "XRP", "aa"), fee: BigInt(1) },
      10,
      timestamp
    );
    event.transaction_id = fdcTx;
    await db.addEvent([event]);

    await closeRound(votingRound);

    const service = new FdcRoundReportService(db.em, configService);
    const report = await service.getFdcRoundReport(votingRound);
    expect(report.attestation_requests[0].attestation_request.id.tx_hash).to.be.equal("0x" + fdcTx.hash);
  });

  it("serves cached reports when enabled and recomputes when disabled", async () => {
    const voters = generateVoters(2);
    const rewardEpochId = 1;
    await setUpRewardEpoch(rewardEpochId, voters);
    const votingRound = EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpochId);

    await addAttestationRequestEvent(requestData("Payment", "XRP", "aa"), votingRound, 1, 10);
    await addBitVoteTx(voters[0].submitAddress, votingRound, bitVoteHex(1, 0b1), 1, 20);

    await closeRound(votingRound);

    const cachedService = new FdcRoundReportService(
      db.em,
      new ConfigService({ ...configValues, fdc_result_cache_size: 2 })
    );
    const uncachedService = new FdcRoundReportService(db.em, configService);

    expect((await cachedService.getFdcRoundReport(votingRound)).count).to.be.equal(1);
    expect((await uncachedService.getFdcRoundReport(votingRound)).count).to.be.equal(1);

    // Delete the FdcHub events; the cached service must still serve the old report.
    await db.em
      .createQueryBuilder()
      .delete()
      .from(TLPEvents)
      .where("address = :address", { address: queryBytesFormat(CONTRACTS.FdcHub.address) })
      .execute();

    expect((await cachedService.getFdcRoundReport(votingRound)).count).to.be.equal(1);
    expect((await uncachedService.getFdcRoundReport(votingRound)).count).to.be.equal(0);
  });
});
