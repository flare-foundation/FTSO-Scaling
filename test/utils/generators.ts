import { TLPEvents, TLPState, TLPTransaction } from "../../libs/ftso-core/src/orm/entities";
import {
  InflationRewardsOffered,
  RandomAcquisitionStarted,
  RewardEpochStarted,
  RewardOffers,
  RewardsOffered,
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
import Web3, { utils } from "web3";
import { RewardEpoch } from "../../libs/ftso-core/src/RewardEpoch";

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
export function generateRewardEpochEvents(
  epochSettings: EpochSettings,
  feeds: Feed[],
  offerCount: number,
  rewardEpochId: number,
  voters: TestVoter[]
): TLPEvents[] {
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

export function generateEvent(
  contract: { name: string; address: string },
  eventName: string,
  eventData: any,
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

export function generateAddress(name: string) {
  return Web3.utils.keccak256(name).slice(0, 42);
}

/**
 * @param feed has to be a string of length 8
 * @param rewardEpochId
 * @param claimBack
 * @returns
 */
export function generateRewardsOffer(feed: string, rewardEpochId: number, claimBack: string) {
  feed = feed.slice(0, 7);

  const rawRewardsOffered = {
    rewardEpochId: Web3.utils.numberToHex(rewardEpochId),
    feedName: Web3.utils.padRight(Web3.utils.utf8ToHex(feed), 16),
    decimals: "0x12",
    amount: "0x10000000000",
    minRewardedTurnoutBIPS: Web3.utils.numberToHex(100),
    primaryBandRewardSharePPM: Web3.utils.numberToHex(10000),
    secondaryBandWidthPPM: Web3.utils.numberToHex(10000),
    claimBackAddress: generateAddress(claimBack),
  };

  return new RewardsOffered(rawRewardsOffered);
}

/**
 *
 * @param feeds
 * @param rewardEpochId
 */
export function generateInflationRewardOffer(feeds: string[], rewardEpochId: number) {
  const unprefixedFeedsInHex = feeds.map(feed => Web3.utils.padRight(Web3.utils.utf8ToHex(feed), 16).slice(2, 18));

  const rawInflationRewardOffer = {
    rewardEpochId: Web3.utils.numberToHex(rewardEpochId),
    feedNames: "0x" + unprefixedFeedsInHex.join(""),
    decimals: "0x" + "12".repeat(feeds.length),
    amount: "0x10000000001",
    minRewardedTurnoutBIPS: Web3.utils.numberToHex(100),
    primaryBandRewardSharePPM: Web3.utils.numberToHex(10000),
    secondaryBandWidthPPMs: "0x" + "002710".repeat(feeds.length),
    mode: "0x00",
  };

  return new InflationRewardsOffered(rawInflationRewardOffer);
}

export function generateRawFullVoter(name: string, rewardEpochId: number, weight: number) {
  return {
    rewardEpochId: Web3.utils.numberToHex(rewardEpochId),
    voter: generateAddress(name),
    wNatWeight: BigInt(weight),
    wNatCappedWeight: BigInt(weight),
    nodeIds: [unsafeRandomHex(20), unsafeRandomHex(20)],
    nodeWeights: [BigInt(weight), BigInt(weight)],
    delegationFeeBIPS: 0,
    signingPolicyAddress: generateAddress(name + "signing"),
    delegationAddress: generateAddress(name + "delegation"),
    submitAddress: generateAddress(name + "submit"),
    submitSignaturesAddress: generateAddress(name + "submitSignatures"),
    registrationWeight: BigInt(weight),
  };
}

export function generateRawFullVoters(count: number, rewardEpochId: number) {
  const rawFullVoters = [];
  for (let j = 0; j < count; j++) {
    rawFullVoters.push(generateRawFullVoter(`${j}`, rewardEpochId, (j * 1000) % 65536));
  }

  return rawFullVoters;
}

export function generateRewardEpoch() {
  const rewardEpochId = 513;
  const rewardEpochIdHex = (id: number) => Web3.utils.padLeft(Web3.utils.numberToHex(id), 6);

  const epochSettings = new EpochSettings(10002, 90, 1, 3600, 30);

  const rawPreviousEpochStarted = {
    rewardEpochId: rewardEpochIdHex(rewardEpochId - 1),
    startVotingRoundId: "0x00100000",
    timestamp: "0x1200000000000000",
  };

  const previousRewardEpochStartedEvent = new RewardEpochStarted(rawPreviousEpochStarted);

  const rawRandomAcquisitionStarted = {
    rewardEpochId: rewardEpochIdHex(rewardEpochId),
    timestamp: "0x1200000000000014",
  };

  const randomAcquisitionStartedEvent = new RandomAcquisitionStarted(rawRandomAcquisitionStarted);

  const rewardsOffered: RewardsOffered[] = [];

  for (let j = 0; j < 10; j++) {
    const rewardOffered = generateRewardsOffer(`USD C${j}`, rewardEpochId, generateAddress(`${j}`));
    rewardsOffered.push(rewardOffered);
  }

  const inflationOffers: InflationRewardsOffered[] = [];

  let feedNames: string[] = [];
  for (let j = 0; j < 3; j++) {
    feedNames.push(`USD C${j}`);
  }

  inflationOffers.push(generateInflationRewardOffer(feedNames, rewardEpochId));

  feedNames = [];

  for (let j = 3; j < 11; j++) {
    feedNames.push(`USD C${j}`);
  }

  inflationOffers.push(generateInflationRewardOffer(feedNames, rewardEpochId));

  const rewardOffers: RewardOffers = {
    inflationOffers,
    rewardOffers: rewardsOffered,
  };

  const rawVoterPowerBlockSelected = {
    rewardEpochId: rewardEpochIdHex(rewardEpochId),
    votePowerBlock: "0xa38424",
    timestamp: "0x1200000000000000",
  };

  const voterPowerBlockSelected = new VotePowerBlockSelected(rawVoterPowerBlockSelected);

  const voters = generateRawFullVoters(10, rewardEpochId);

  const rawSigningPolicyInitialized = {
    rewardEpochId: rewardEpochIdHex(rewardEpochId),
    startVotingRoundId: Web3.utils.numberToHex(rewardEpochId * 3600),
    threshold: Number(voters.map(v => v.registrationWeight).reduce((a, b) => a + b, 0n)) / 2,
    seed: "0xaaaa",
    signingPolicyBytes: "0x12",
    timestamp: "0x1200000000000001",
    voters: voters.map(voter => voter.signingPolicyAddress),
    weights: voters.map(v => v.registrationWeight),
  };

  const signingPolicyInitialized = new SigningPolicyInitialized(rawSigningPolicyInitialized);

  const fullVotersRegistrationInfo = voters.map(voter => {
    return {
      voterRegistrationInfo: new VoterRegistrationInfo(voter),
      voterRegistered: new VoterRegistered(voter),
    };
  });

  const rewardEpoch = new RewardEpoch(
    previousRewardEpochStartedEvent,
    randomAcquisitionStartedEvent,
    rewardOffers,
    voterPowerBlockSelected,
    signingPolicyInitialized,
    fullVotersRegistrationInfo
  );

  return rewardEpoch;
}
