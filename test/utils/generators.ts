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
import { EncodingUtils } from "../../libs/ftso-core/src/utils/EncodingUtils";
import { queryBytesFormat } from "../../libs/ftso-core/src/IndexerClient";
import { Bytes20, Feed } from "../../libs/ftso-core/src/voting-types";
import { encodeParameters, encodeParameter } from "web3-eth-abi";
import { EpochSettings } from "../../libs/ftso-core/src/utils/EpochSettings";
import { generateRandomAddress, randomHash, unsafeRandomHex } from "./testRandom";
import { utils } from "web3";

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
    nodeIds: [unsafeRandomHex(20), unsafeRandomHex(20)],
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

export function generateState(name: string, id: number, timestamp?: number): TLPState {
  const state = new TLPState();
  state.id = id;
  state.name = name;
  state.index = id;
  state.block_timestamp = timestamp ?? 0;
  state.updated = new Date("2024-01-01");
  return state;
}

// TODO: fix event timings
export async function generateRewardEpochEvents(
  epochSettings: EpochSettings,
  feeds: Feed[],
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
      1,
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
      2,
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
      3,
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
      4,
      rewardEpochStartSec + 50
    ),
  ];
}

function generateRewards(offerCount: number, feeds: Feed[], rewardEpochId: number, timestamp: number) {
  const events = [];
  for (let i = 0; i < offerCount; i++) {
    events.push(
      generateEvent(
        CONTRACTS.FtsoRewardOffersManager,
        "InflationRewardsOffered",
        {
          rewardEpochId,
          feedNames: "0x" + feeds.map(f => f.name).join(""),
          decimals: "0x" + feeds.map(f => f.decimals.toString(16).padStart(2, "0")).join(""),
          amount: BigInt(1000),
          minRewardedTurnoutBIPS: 100,
          primaryBandRewardSharePPM: 10000,
          secondaryBandWidthPPMs: "0x" + feeds.map(() => "002710").join(""), // 10_000
          mode: 0,
        },
        1,
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
            feedName: "0x" + feed.name,
            decimals: feed.decimals,
            amount: BigInt(1000),
            minRewardedTurnoutBIPS: 100,
            primaryBandRewardSharePPM: 10000,
            secondaryBandWidthPPM: 10000,
            claimBackAddress: burnAddress,
          },
          2,
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
        1,
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
        1,
        timestamp
      )
    );
  }
  return events;
}

export function generateEvent(
  contract: { name: string; address: string },
  eventName: string,
  eventData: any,
  blockNumber: number,
  timestamp: number
): TLPEvents {
  const topic0 = encodingUtils.getEventSignature(contract.name, eventName);
  const abi = encodingUtils.getEventAbiData(contract.name, eventName);
  const types = abi.abi.inputs.filter(x => !x.indexed).map(x => x.type);
  const values = abi.abi.inputs.filter(x => !x.indexed).map(x => eventData[x.name]);
  const indexedTypes = abi.abi.inputs.filter(x => x.indexed).map(x => x.type);
  const indexedValues = abi.abi.inputs.filter(x => x.indexed).map(x => eventData[x.name]);
  const data = encodeParameters(types, values);

  if (indexedTypes.length > 3) {
    throw new Error("Too many indexed types");
  }

  const e = new TLPEvents();
  e.address = queryBytesFormat(contract.address);
  e.data = queryBytesFormat(data);
  e.topic0 = queryBytesFormat(topic0);
  e.topic1 = indexedValues.length >= 1 ? encodeParameter(indexedTypes[0], indexedValues[0]) : "NULL";
  e.topic2 = indexedValues.length >= 2 ? encodeParameter(indexedTypes[1], indexedValues[1]) : "NULL";
  e.topic3 = indexedValues.length >= 3 ? encodeParameter(indexedTypes[2], indexedValues[2]) : "NULL";
  e.log_index = 1;
  e.block_number = blockNumber;
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
  tx.value = queryBytesFormat(utils.toHex(1));
  tx.gas_price = queryBytesFormat(utils.toHex(1000));
  tx.gas = 10000;
  tx.timestamp = timestamp;
  tx.hash = queryBytesFormat(randomHash());
  tx.function_sig = queryBytesFormat(functionSig);
  return tx;
}

export function currentTimeSec(): number {
  return Math.floor(Date.now() / 1000);
}
