import { TLPEvents, TLPState, TLPTransaction } from "../../libs/ftso-core/src/orm/entities";
import {
  RandomAcquisitionStarted,
  RewardEpochStarted,
  SigningPolicyInitialized,
  VotePowerBlockSelected,
  VoterRegistered,
  VoterRegistrationInfo,
} from "../../libs/ftso-core/src/events";
import { CONTRACTS } from "../../libs/ftso-core/src/configs/networks";
import { EncodingUtils, unPrefix0x } from "../../libs/ftso-core/src/utils/EncodingUtils";
import { keccak256 } from "ethers";
import { toHex } from "../../libs/ftso-core/src/utils/voting-utils";
import { queryBytesFormat } from "../../libs/ftso-core/src/IndexerClient";
import { Bytes20 } from "../../libs/ftso-core/src/voting-types";
import Prando from "prando";
import Web3 from "web3";
import crypto from "crypto";
import { EpochSettings } from "../../libs/ftso-core/src/utils/EpochSettings";

const web3 = new Web3();
const coder = web3.eth.abi;
const random = new Prando(42);
const encodingUtils = EncodingUtils.instance;
const burnAddress = generateRandomAddress();

export interface TestVoter {
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

export function generateVoter(): TestVoter {
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

export function generateVoters(count: number): TestVoter[] {
  const voters: TestVoter[] = [];
  for (let i = 0; i < count; i++) {
    voters.push(generateVoter());
  }
  return voters;
}

export function generateState(name: string, id: number): TLPState {
  const state = new TLPState();
  state.id = id;
  state.name = name;
  state.index = id;
  state.block_timestamp = 0;
  state.updated = new Date("2024-01-01");
  return state;
}

// TODO: fix event timings
export async function generateRewardEpochEvents(
  epochSettings: EpochSettings,
  feeds: string[],
  offerCount: number,
  rewardEpochId: number,
  voters: TestVoter[]
): Promise<TLPEvents[]> {
  const previousRewardEpochId = rewardEpochId - 1;
  const rewardEpochStartSec = epochSettings.expectedRewardEpochStartTimeSec(previousRewardEpochId);
  return [
    generateEvent(
      CONTRACTS.FlareSystemManager,
      RewardEpochStarted.eventName,
      new RewardEpochStarted({
        rewardEpochId: previousRewardEpochId,
        startVotingRoundId: epochSettings.expectedFirstVotingRoundForRewardEpoch(previousRewardEpochId),
        timestamp: rewardEpochStartSec,
      }),
      rewardEpochStartSec
    ),
    ...generateRewards(offerCount, feeds, rewardEpochId, rewardEpochStartSec + 10),

    generateEvent(
      CONTRACTS.FlareSystemManager,
      RandomAcquisitionStarted.eventName,
      new RandomAcquisitionStarted({
        rewardEpochId: rewardEpochId,
        timestamp: rewardEpochStartSec + 20,
      }),
      rewardEpochStartSec + 20
    ),
    generateEvent(
      CONTRACTS.FlareSystemManager,
      VotePowerBlockSelected.eventName,
      new VotePowerBlockSelected({
        rewardEpochId: rewardEpochId,
        votePowerBlock: 1, // TODO: set block numbers
        timestamp: rewardEpochStartSec + 30,
      }),
      rewardEpochStartSec + 30
    ),

    ...registerVoters(voters, rewardEpochId, rewardEpochStartSec + 40),

    // TODO: set correct values for signing policy
    generateEvent(
      CONTRACTS.Relay,
      SigningPolicyInitialized.eventName,
      new SigningPolicyInitialized({
        rewardEpochId: rewardEpochId,
        startVotingRoundId: epochSettings.expectedFirstVotingRoundForRewardEpoch(rewardEpochId),
        threshold: 1,
        seed: "0x123",
        voters: voters.map(v => v.signingAddress),
        weights: voters.map(v => v.registrationWeight),
        signingPolicyBytes: "0x123",
        timestamp: rewardEpochStartSec + 50,
      }),
      rewardEpochStartSec + 50
    ),
  ];
}

function generateRewards(offerCount: number, feeds: string[], rewardEpochId: number, timestamp: number) {
  const events = [];
  for (let i = 0; i < offerCount; i++) {
    events.push(
      generateEvent(
        CONTRACTS.FtsoRewardOffersManager,
        "InflationRewardsOffered",
        {
          rewardEpochId,
          feedNamesEncoded: "0x" + feeds.join(""),
          decimals: "0x" + feeds.map(() => "01").join(""),
          amount: BigInt(1000),
          minimalThresholdBIPS: 100,
          primaryBandRewardSharePPM: 10000,
          secondaryBandWidthPPMsEncoded: "0x" + feeds.map(() => "002710").join(""), // 10_000
          mode: 0,
        },
        timestamp
      )
    );

    for (const feed of feeds) {
      events.push(
        generateEvent(
          CONTRACTS.FtsoRewardOffersManager,
          "RewardsOffered",
          {
            rewardEpochId,
            feedName: "0x" + feed,
            decimals: 1,
            amount: BigInt(1000),
            minimalThresholdBIPS: 100,
            primaryBandRewardSharePPM: 10000,
            secondaryBandWidthPPM: 10000,
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
      generateEvent(
        CONTRACTS.FlareSystemCalculator,
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
      generateEvent(
        CONTRACTS.VoterRegistry,
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

function generateEvent(
  contract: { name: string; address: string },
  eventName: string,
  eventData: any,
  timestamp: number
): TLPEvents {
  const topic0 = encodingUtils.getEventSignature(contract.name, eventName);
  const abi = encodingUtils.getEventAbiData(contract.name, eventName);
  const types = abi.abi.inputs.map(x => x.type);
  const values = Object.getOwnPropertyNames(eventData).map(x => eventData[x]);
  const data = coder.encodeParameters(types, values);

  const e = new TLPEvents();
  e.address = queryBytesFormat(contract.address);
  e.data = queryBytesFormat(data);
  e.topic0 = queryBytesFormat(topic0);
  e.topic1 = "";
  e.topic2 = "";
  e.topic3 = "";
  e.log_index = 1;
  e.timestamp = timestamp;
  return e;
}

export function generateTx(
  from: string,
  to: string,
  functionSig: string,
  blockNo: number,
  timestamp: number,
  payload: string
) {
  const tx = new TLPTransaction();
  tx.block_number = blockNo;
  tx.block_hash = queryBytesFormat(randomHash());
  tx.transaction_index = 0;
  tx.from_address = queryBytesFormat(from);
  tx.to_address = queryBytesFormat(to);
  tx.input = queryBytesFormat(payload);
  tx.status = 1;
  tx.value = queryBytesFormat(toHex(1));
  tx.gas_price = queryBytesFormat(toHex(1000));
  tx.gas = 10000;
  tx.timestamp = timestamp;
  tx.hash = queryBytesFormat(randomHash());
  tx.function_sig = queryBytesFormat(functionSig);
  return tx;
}

function generateRandomBytes20(): string {
  const bytes = crypto.randomBytes(20);
  const hex = bytes.toString("hex");
  return `0x${hex}`;
}

export function generateRandomAddress(): string {
  const account = web3.eth.accounts.create(random.nextString());
  return account.address.toLowerCase();
}

function randomHash() {
  const array = new Uint8Array(40);
  for (let i = 0; i < array.length; i++) {
    array[i] = random.nextInt(0, 255);
  }
  return keccak256(array).slice(2);
}

export function curretTimeSec(): number {
  return Math.floor(Date.now() / 1000);
}