import Web3 from "web3";
import { RewardEpoch, VoterWeights } from "../../libs/ftso-core/src/RewardEpoch";
import { ZERO_BYTES32 } from "../../libs/ftso-core/src/constants";
import {
  InflationRewardsOffered,
  RandomAcquisitionStarted,
  RewardEpochStarted,
  RewardsOffered,
  SigningPolicyInitialized,
  VotePowerBlockSelected,
  VoterRegistered,
  VoterRegistrationInfo,
} from "../../libs/contracts/src/events";
import { calculateMedian } from "../../libs/ftso-core/src/ftso-calculation/ftso-median";
import { TLPEvents } from "../../libs/ftso-core/src/orm/entities";
import { EpochSettings } from "../../libs/ftso-core/src/utils/EpochSettings";
import { ValueWithDecimals } from "../../libs/ftso-core/src/data/FeedValueEncoder";
import { Bytes32 } from "../../libs/ftso-core/src/utils/sol-types";
import { Feed, MedianCalculationResult } from "../../libs/ftso-core/src/voting-types";
import { TestVoter, generateEvent } from "./basic-generators";
import { generateRandomAddress, unsafeRandomHex } from "./testRandom";
import {AbiCache} from "../../libs/contracts/src/abi/AbiCache";
import {CONTRACTS} from "../../libs/contracts/src/constants";


import { RewardOffers } from "../../libs/ftso-core/src/data/RewardOffers";

export const encodingUtils = AbiCache.instance;
const burnAddress = generateRandomAddress();
export const web3 = new Web3("https://dummy");
const FEED_TYPE_CRYPTO = "0x01";

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
      CONTRACTS.FlareSystemsManager,
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
      CONTRACTS.FlareSystemsManager,
      RandomAcquisitionStarted.eventName,
      new RandomAcquisitionStarted({
        rewardEpochId: rewardEpochId,
        timestamp: rewardEpochStartSec + 20,
      }),
      2,
      rewardEpochStartSec + 20
    ),
    generateEvent(
      CONTRACTS.FlareSystemsManager,
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
        seed: BigInt("0x123"),
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
          feedIds: "0x" + feeds.map(f => f.id).join(""),
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
            feedId: "0x" + feed.id,
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
        CONTRACTS.FlareSystemsCalculator,
        "VoterRegistrationInfo",
        new VoterRegistrationInfo({
          voter: voter.identityAddress,
          rewardEpochId: rewardEpoch,
          delegationAddress: voter.delegationAddress,
          delegationFeeBIPS: voter.delegationFeeBIPS,
          wNatWeight: voter.wNatWeight,
          wNatCappedWeight: voter.wNatCappedWeight,
          nodeIds: voter.nodeIds,
          nodeWeights: voter.nodeWeights,
        }),
        1,
        timestamp
      )
    );
    events.push(
      generateEvent(
        CONTRACTS.VoterRegistry,
        "VoterRegistered",
        {
          voter: voter.identityAddress,
          rewardEpochId: rewardEpoch,
          signingPolicyAddress: voter.signingAddress,
          submitAddress: voter.submitAddress,
          submitSignaturesAddress: voter.submitSignaturesAddress,
          publicKeyPart1: Bytes32.ZERO.toString(),
          publicKeyPart2: Bytes32.ZERO.toString(),
          registrationWeight: voter.registrationWeight,
        },
        1,
        timestamp
      )
    );
  }
  return events;
}

export function currentTimeSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function generateAddress(name: string) {
  return Web3.utils.keccak256(name).slice(0, 42);
}

/**
 * @param feedName has to be a string of length up to 20
 */
export function generateRewardsOffer(
  feedName: string,
  rewardEpochId: number,
  claimBack: string,
  value: number,
  secondaryBandWidthPPM: number = 2000
) {
  feedName = feedName.slice(0, 19);

  const rawRewardsOffered = {
    rewardEpochId: Web3.utils.numberToHex(rewardEpochId),
    feedId: toFeedId(feedName),
    decimals: "0x02",
    amount: Web3.utils.numberToHex(value),
    minRewardedTurnoutBIPS: Web3.utils.numberToHex(1000),
    primaryBandRewardSharePPM: Web3.utils.numberToHex(8000),
    secondaryBandWidthPPM: Web3.utils.numberToHex(secondaryBandWidthPPM),
    claimBackAddress: generateAddress(claimBack),
  };

  return new RewardsOffered(rawRewardsOffered);
}

/**
 * Generate an inflation reward offer for given feeds
 */
export function generateInflationRewardOffer(feedNames: string[], rewardEpochId: number) {
  const unprefixedFeedsInHex = feedNames.map(name => toFeedId(name, true));

  const rawInflationRewardOffer = {
    rewardEpochId: Web3.utils.numberToHex(rewardEpochId),
    feedIds: "0x" + unprefixedFeedsInHex.join(""),
    decimals: "0x" + "02".repeat(feedNames.length),
    amount: "0x10000000001",
    minRewardedTurnoutBIPS: Web3.utils.numberToHex(1000),
    primaryBandRewardSharePPM: Web3.utils.numberToHex(8000),
    secondaryBandWidthPPMs: "0x" + "0007d0".repeat(feedNames.length),
    mode: "0x00",
  };

  return new InflationRewardsOffered(rawInflationRewardOffer);
}

export function generateRawFullVoter(name: string, rewardEpochId: number, weight: number, delegationFee: number) {
  return {
    rewardEpochId: Web3.utils.numberToHex(rewardEpochId),
    voter: generateAddress(name),
    wNatWeight: BigInt(weight),
    wNatCappedWeight: BigInt(weight),
    nodeIds: [unsafeRandomHex(20), unsafeRandomHex(20)],
    nodeWeights: [BigInt(weight), BigInt(weight)],
    delegationFeeBIPS: delegationFee,
    signingPolicyAddress: generateAddress(name + "signing"),
    delegationAddress: generateAddress(name + "delegation"),
    submitAddress: generateAddress(name + "submit"),
    submitSignaturesAddress: generateAddress(name + "submitSignatures"),
    registrationWeight: BigInt(weight),
    publicKeyPart1: ZERO_BYTES32,
    publicKeyPart2: ZERO_BYTES32,
  };
}

export function generateRawFullVoters(count: number, rewardEpochId: number) {
  const rawFullVoters = [];
  for (let j = 0; j < count; j++) {
    rawFullVoters.push(generateRawFullVoter(`${j}`, rewardEpochId, (j * 1000) % 65536, j * 10));
  }
  return rawFullVoters;
}

export function generateRewardEpoch() {
  const rewardEpochId = 513;
  const rewardEpochIdHex = (id: number) => Web3.utils.padLeft(Web3.utils.numberToHex(id), 6);

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
    const rewardOffered = generateRewardsOffer(`USD C${j}`, rewardEpochId, generateAddress(`${j}`), j * 1000000);
    rewardsOffered.push(rewardOffered);
  }

  const inflationOffers: InflationRewardsOffered[] = [];

  let feedIds: string[] = [];
  for (let j = 0; j < 3; j++) {
    feedIds.push(`USD C${j}`);
  }

  inflationOffers.push(generateInflationRewardOffer(feedIds, rewardEpochId));

  feedIds = [];

  for (let j = 3; j < 11; j++) {
    feedIds.push(`USD C${j}`);
  }

  inflationOffers.push(generateInflationRewardOffer(feedIds, rewardEpochId));

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

  const voters = generateRawFullVoters(50, rewardEpochId);

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

export function generateVotersWeights(numberOfVoters: number) {
  const votersWeights = new Map<string, VoterWeights>();

  for (let j = 0; j < numberOfVoters; j++) {
    const voterWeight: VoterWeights = {
      identityAddress: generateAddress(`${j}identity`),
      submitAddress: generateAddress(`${j}`),
      delegationAddress: generateAddress(`${j}delegation`),
      signingAddress: generateAddress(`${j}signing`),
      delegationWeight: BigInt(1000 + (j % 5)),
      cappedDelegationWeight: BigInt(1000 + (j % 5)),
      signingWeight: 1000 + (j % 5) + 3,
      feeBIPS: (j % 5) * 100,
      nodeIds: [unsafeRandomHex(20), unsafeRandomHex(20)],
      nodeWeights: [BigInt(1000 + (j % 5)), BigInt(1000 + (j % 5))],
    };

    votersWeights.set(voterWeight.submitAddress, voterWeight);
  }

  return votersWeights;
}

export function generateMedianCalculationResult(
  numberOfVoters: number,
  feedName: string,
  votingRoundId: number,
  lowTurnout = false
) {
  const voters: string[] = [];
  const feedValues: ValueWithDecimals[] = [];

  const weights: bigint[] = [];

  for (let j = 0; j < numberOfVoters; j++) {
    const valueWithDecimal: ValueWithDecimals = {
      isEmpty: lowTurnout ? j != 3 : !((j + 1) % 13),
      value: 1000 + (j % 50),
      decimals: 2,
    };
    voters.push(generateAddress(`${j}`));
    feedValues.push(valueWithDecimal);
    weights.push(100n + BigInt(j));
  }

  const data = calculateMedian(voters, feedValues, weights, 2);

  const feed: Feed = {
    id: toFeedId(feedName),
    decimals: 2,
  };

  const medianCalculationResult: MedianCalculationResult = {
    votingRoundId,
    feed,
    votersSubmitAddresses: voters,
    feedValues,
    data,
    weights,
    totalVotingWeight: weights.reduce((a, b) => a + b, 0n),
  };

  return medianCalculationResult;
}

export function toFeedId(feedName: string, unprefixed: boolean = false) {
  const feedIdHex = FEED_TYPE_CRYPTO + Web3.utils.utf8ToHex(feedName).slice(2).padEnd(40, "0");
  if (unprefixed) return feedIdHex.slice(2);
  else return feedIdHex;
}
