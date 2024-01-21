import Web3 from "web3";

import fs from "fs";
import { DataSource, EntityManager } from "typeorm";
import { TLPEvents, TLPState, TLPTransaction } from "../../libs/ftso-core/src/orm/entities";
import { retry } from "../../apps/ftso-data-provider/src/utils/retry";
import {
  RandomAcquisitionStarted,
  RewardEpochStarted,
  SigningPolicyInitialized,
  VotePowerBlockSelected,
  VoterRegistered,
  VoterRegistrationInfo,
} from "../../libs/ftso-core/src/events";
import {
  CONTRACTS,
  EPOCH_SETTINGS,
  FIRST_DATABASE_INDEX_STATE,
  LAST_DATABASE_INDEX_STATE,
} from "../../libs/ftso-core/src/configs/networks";
import { EncodingUtils } from "../../libs/ftso-core/src/utils/EncodingUtils";
import { keccak256 } from "ethers";
import Prando from "prando";
import { toHex } from "../../libs/ftso-core/src/utils/voting-utils";
import { Bytes20 } from "../../libs/ftso-core/src/voting-types";
import crypto from "crypto";
import { IndexerClient } from "../../libs/ftso-core/src/IndexerClient";

const web3 = new Web3();
const random = new Prando(42);

interface TestVoter {
  identityAddress: string;
  signingAddress: string;
  submitAddress: string;
  submitSignaturesAddress: string;
  delegationAddress: string;
  registrationWeight: bigint;
  wNatCappedWeight: bigint;
  // Unused
  wNatWeight: bigint;
  nodeIds: Bytes20[];
  nodeWeights: bigint[];
  delegationFeeBIPS: number;
}

function generateVoter(): TestVoter {
  return {
    identityAddress: generateRandomAddress(),
    signingAddress: generateRandomAddress(),
    submitAddress: generateRandomAddress(),
    submitSignaturesAddress: generateRandomAddress(),
    delegationAddress: generateRandomAddress(),
    registrationWeight: BigInt(1000),
    wNatCappedWeight: BigInt(1000),
    wNatWeight: BigInt(1000),
    nodeIds: [generateRandomBytes20(), generateRandomBytes20()],
    nodeWeights: [BigInt(1000), BigInt(1000)],
    delegationFeeBIPS: 0,
  };
}
function generateRandomBytes20(): string {
  const bytes = crypto.randomBytes(20);
  const hex = bytes.toString("hex");
  return `0x${hex}`;
}

function generateRandomAddress(): string {
  const account = web3.eth.accounts.create(random.nextString());
  return account.address;
}

const randomAddress = generateRandomAddress();
console.log(randomAddress);

/**
 * TODO:
 * - Define voters with signing and submit addresses.
 * - Add logic for generating events for reward epoch.
 *   - Signing policy stuff
 *   - Reward offers
 *   - Voter registrations
 * - Add logic for generating revealdata and commits for voting rounds.
 *
 * Tests:
 * - Happy path: generate commits and reveals, and check the result matches the expected median basaed on weights. And randoms
 * - Non happy path:
 *   - Missing commits/reveals.
 *   - Delay in blockchain - no new blocks
 */

const coder = new Web3().eth.abi;

/*
 * The lifecycle of events leading to signing policy initialization is as follows.
 * For given rewardEpochId:
 * - Start of reward offers (low boundary event).
 *    - ["FlareSystemManager", undefined, "RewardEpochStarted"], for rewardEpochId - 1.
 * - End of reward offers (high boundary event).
 *    - ["FlareSystemManager", undefined, "RandomAcquisitionStarted"],
 * - Reward offers between the timestamps of the above two events.
 *    - ["FtsoRewardOffersManager", undefined, "InflationRewardsOffered"],
 *    - ["FtsoRewardOffersManager", undefined, "RewardsOffered"],
 * - Start of voter registration (low boundary event).
 *    - ["FlareSystemManager", undefined, "VotePowerBlockSelected"]
 * - End of voter registration and signing policy (high boundary event)
 *    - ["Relay", undefined, "SigningPolicyInitialized"],
 * - All voter registration events and related voter info events,
 *   between the timestamps of the above two events.
 *    - ["VoterRegistry", undefined, "VoterRegistered"],
 *    - ["FlareSystemCalculator", undefined, "VoterRegistrationInfo"],
 * All these events should be available before the first voting round of the rewardEpochId in order for
 * the protocol data provider to function properly.
 */

const feeds = ["0000000000000000", "0000000000000001"];

const voters: TestVoter[] = generateVoters(4);

const burnAddress = generateRandomAddress();
const offerCount = 2;

const epochSettings = EPOCH_SETTINGS;

describe("test", () => {
  it.only("should load DB", async () => {
    const ds = await getDataSource(false);
    const em = ds.createEntityManager();

    await generateRewardEpochEvents(em, 1, voters);

    const lowerState = generateState(FIRST_DATABASE_INDEX_STATE, 0);
    const upperState = generateState(LAST_DATABASE_INDEX_STATE, 1);
    lowerState.block_timestamp = 0;
    upperState.block_timestamp = epochSettings.expectedRewardEpochStartTimeSec(2);
    await em.save([lowerState, upperState]);



    const policy = await em.find(TLPEvents);
    const last = policy[policy.length - 1];
    console.log("Last event:" + JSON.stringify(last));
    console.log("Got events:" + JSON.stringify(SigningPolicyInitialized.fromRawEvent(last)));



    const indexerClient = new IndexerClient(em, 10);

    const initialized = await indexerClient.getSigningPolicyInitializedEvent(2)
    console.log("Got SP events:" + JSON.stringify(initialized));

    ds.destroy();
  });
});

function generateVoters(count: number): TestVoter[] {
  const voters: TestVoter[] = [];
  for (let i = 0; i < count; i++) {
    voters.push(generateVoter());
  }
  return voters;
}

function generateState(name: string, id: number): TLPState {
  const state = new TLPState();
  state.id = id;
  state.name = name;
  state.index = id;
  state.block_timestamp = 0;
  state.updated = new Date("2024-01-01");
  return state;
}

// TODO: fix event timings
async function generateRewardEpochEvents(em: EntityManager, rewardEpochId: number, voters: TestVoter[]) {
  const rewardEpochStartSec = epochSettings.expectedRewardEpochStartTimeSec(rewardEpochId);
  const events = [
    generateTLPEvent(
      CONTRACTS.FlareSystemManager.name,
      RewardEpochStarted.eventName,
      new RewardEpochStarted({
        rewardEpochId,
        startVotingRoundId: 1,
        timestamp: rewardEpochStartSec,
      }),
      rewardEpochStartSec
    ),
    ...generateRewards(feeds, rewardEpochId, rewardEpochStartSec + 10),

    generateTLPEvent(
      CONTRACTS.FlareSystemManager.name,
      RandomAcquisitionStarted.eventName,
      new RandomAcquisitionStarted({
        rewardEpochId: rewardEpochId,
        timestamp: rewardEpochStartSec,
      }),
      rewardEpochStartSec + 20
    ),
    generateTLPEvent(
      CONTRACTS.FlareSystemManager.name,
      VotePowerBlockSelected.eventName,
      new VotePowerBlockSelected({
        rewardEpochId: rewardEpochId,
        votePowerBlock: 1, // TODO: set block numbers
        timestamp: rewardEpochStartSec,
      }),
      rewardEpochStartSec + 30
    ),

    // Register voters
    // First emit voterregistration info.
    // Then voter registered.
    ...registerVoters(voters, rewardEpochId, rewardEpochStartSec + 40),

    // TODO: set correct values for signing policy
    generateTLPEvent(
      CONTRACTS.Relay.name,
      SigningPolicyInitialized.eventName,
      new SigningPolicyInitialized({
        rewardEpochId: rewardEpochId + 1,
        startVotingRoundId: 1,
        threshold: 1,
        seed: "0x123",
        voters: voters.map(v => v.identityAddress),
        weights: voters.map(v => v.registrationWeight),
        signingPolicyBytes: "0x123",
        timestamp: rewardEpochStartSec + 50,
      }),
      rewardEpochStartSec + 50
    ),
  ];

  await em.save(events);
}

function generateRewards(feeds: string[], rewardEpochId: number, timestamp: number) {
  const events = [];
  for (let i = 0; i < offerCount; i++) {
    events.push(
      generateTLPEvent(
        CONTRACTS.FtsoRewardOffersManager.name,
        "InflationRewardsOffered",
        {
          rewardEpochId,
          feedNamesEncoded: "0x" + feeds.join(""),
          decimals: 1,
          amount: BigInt(1000),
          mode: 0,
          primaryBandRewardSharePPM: 10000,
          secondaryBandWidthPPMsEncoded: "0x" + feeds.map(() => "002710").join(""),
        },
        timestamp
      )
    );

    for (const feed of feeds) {
      events.push(
        generateTLPEvent(
          CONTRACTS.FtsoRewardOffersManager.name,
          "RewardsOffered",
          {
            rewardEpochId,
            feedName: "0x" + feed,
            decimals: 1,
            amount: BigInt(1000),
            primaryBandRewardSharePPM: 10000,
            secondaryBandWidthPPM: 10000,
            rewardEligibilityPPM: 10000,
            leadProviders: [generateRandomAddress()],
            claimBackAddress: burnAddress,
          },
          timestamp
        )
      );
    }
  }
  return events;
}

function registerVoters(voters: TestVoter[], rewardEpoch: number, timestamp: number): TLPEvents[] {
  const events = [];
  for (const voter of voters) {
    events.push(
      generateTLPEvent(
        CONTRACTS.FlareSystemCalculator.name,
        "VoterRegistrationInfo",
        new VoterRegistrationInfo({
          rewardEpochId: rewardEpoch,
          voter: voter.identityAddress,
          wNatCappedWeight: voter.wNatCappedWeight,
          wNatWeight: voter.wNatWeight,
          nodeIds: voter.nodeIds,
          nodeWeights: voter.nodeWeights,
          delegationFeeBIPS: voter.delegationFeeBIPS,
        }),
        timestamp
      )
    );
    events.push(
      generateTLPEvent(
        CONTRACTS.VoterRegistry.name,
        "VoterRegistered",
        new VoterRegistered({
          voter: voter.identityAddress,
          rewardEpochId: rewardEpoch,
          signingPolicyAddress: voter.signingAddress,
          delegationAddress: voter.delegationAddress,
          submitAddress: voter.submitAddress,
          submitSignaturesAddress: voter.submitSignaturesAddress,
          registrationWeight: voter.registrationWeight,
        }),
        timestamp
      )
    );
  }
  return events;
}

const sqliteDatabase = `:memory:`;
const encodingUtils = EncodingUtils.instance;

function generateTLPEvent(contract: string, eventName: string, eventData: any, timestamp: number) {
  const topic0 = encodingUtils.getEventSignature(contract, eventName);
  const abi = encodingUtils.getEventAbiData(contract, eventName);
  const types = abi.abi.inputs.map(x => x.type);

  console.log(eventData);
  const values = Object.getOwnPropertyNames(eventData).map(x => eventData[x]);
  console.log("Generating " + types + " " + values);
  const data = coder.encodeParameters(types, values);

  const dbEvent = new TLPEvents();
  dbEvent.address = "0x123";
  dbEvent.data = data.slice(2);
  dbEvent.topic0 = topic0.slice(2);
  dbEvent.topic1 = "";
  dbEvent.topic2 = "";
  dbEvent.topic3 = "";
  dbEvent.log_index = 1;
  dbEvent.timestamp = timestamp;
  return dbEvent;
}

function generateTLPTransaction(from: string, to: string, blockNo: number, timestamp: number, payload: string) {
  const dbTransaction = new TLPTransaction();
  dbTransaction.hash = randomHash();
  dbTransaction.block_number = blockNo;
  dbTransaction.block_hash = randomHash();
  dbTransaction.transaction_index = 0;
  dbTransaction.from_address = from;
  dbTransaction.to_address = to;
  dbTransaction.input = payload;
  dbTransaction.status = 1;
  dbTransaction.value = toHex(1);
  dbTransaction.gas_price = toHex(1000);
  dbTransaction.gas = 1000;
  dbTransaction.timestamp = timestamp;
  return dbTransaction;
}

function randomHash() {
  return keccak256(random.next().toString(16)).slice(2);
}

async function getDataSource(readOnly = false) {
  if (!readOnly && fs.existsSync(sqliteDatabase)) {
    fs.unlinkSync(sqliteDatabase);
  }

  const dataSource = new DataSource({
    type: "sqlite",
    database: sqliteDatabase,
    entities: [TLPTransaction, TLPEvents, TLPState],
    synchronize: !readOnly,
    flags: readOnly ? 1 : undefined,
  });
  await retry(async () => {
    await dataSource.initialize();
  });

  return dataSource;
}
