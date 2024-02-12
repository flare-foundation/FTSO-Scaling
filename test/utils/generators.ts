import Web3 from "web3";
import { RewardEpoch, VoterWeights } from "../../libs/ftso-core/src/RewardEpoch";
import { CONTRACTS } from "../../libs/ftso-core/src/configs/networks";
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
import { calculateMedian } from "../../libs/ftso-core/src/ftso-calculation/ftso-median";
import { TLPEvents } from "../../libs/ftso-core/src/orm/entities";
import { EncodingUtils } from "../../libs/ftso-core/src/utils/EncodingUtils";
import { EpochSettings } from "../../libs/ftso-core/src/utils/EpochSettings";
import { ValueWithDecimals } from "../../libs/ftso-core/src/utils/FeedValueEncoder";
import { Feed, MedianCalculationResult } from "../../libs/ftso-core/src/voting-types";
import { TestVoter, generateEvent } from "./basic-generators";
import { generateRandomAddress, unsafeRandomHex } from "./testRandom";

export const encodingUtils = EncodingUtils.instance;
const burnAddress = generateRandomAddress();
export const web3 = new Web3("https://dummy");

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

export function currentTimeSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function generateAddress(name: string) {
  return Web3.utils.keccak256(name).slice(0, 42);
}

export function generateFeedName(name: string) {
  name = name.slice(0, 7);

  return Web3.utils.padRight(Web3.utils.utf8ToHex(name), 16);
}

/**
 * @param feed has to be a string of length 8
 * @param rewardEpochId
 * @param claimBack
 * @returns
 */
export function generateRewardsOffer(feed: string, rewardEpochId: number, claimBack: string, value: number) {
  feed = feed.slice(0, 7);

  const rawRewardsOffered = {
    rewardEpochId: Web3.utils.numberToHex(rewardEpochId),
    feedName: generateFeedName(feed),
    decimals: "0x02",
    amount: Web3.utils.numberToHex(value),
    minRewardedTurnoutBIPS: Web3.utils.numberToHex(100),
    primaryBandRewardSharePPM: Web3.utils.numberToHex(8000),
    secondaryBandWidthPPM: Web3.utils.numberToHex(2000),
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
  const unprefixedFeedsInHex = feeds.map(feed => generateFeedName(feed).slice(2, 18));

  const rawInflationRewardOffer = {
    rewardEpochId: Web3.utils.numberToHex(rewardEpochId),
    feedNames: "0x" + unprefixedFeedsInHex.join(""),
    decimals: "0x" + "02".repeat(feeds.length),
    amount: "0x10000000001",
    minRewardedTurnoutBIPS: Web3.utils.numberToHex(100),
    primaryBandRewardSharePPM: Web3.utils.numberToHex(8000),
    secondaryBandWidthPPMs: "0x" + "0007d0".repeat(feeds.length),
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
    const rewardOffered = generateRewardsOffer(`USD C${j}`, rewardEpochId, generateAddress(`${j}`), j * 1000000);
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
      submitAddress: generateAddress(`${j}`),
      delegationAddress: generateAddress(`${j}delegation`),
      signingAddress: generateAddress(`${j}signing`),
      delegationWeight: BigInt(1000 + (j % 5)),
      cappedDelegationWeight: BigInt(1000 + (j % 5)),
      signingWeight: 1000 + (j % 5) + 3,
      feeBIPS: j * 10,
      nodeIDs: [unsafeRandomHex(20), unsafeRandomHex(20)],
      nodeWeights: [BigInt(1000 + (j % 5)), BigInt(1000 + (j % 5))],
    };

    votersWeights.set(voterWeight.submitAddress, voterWeight);
  }

  return votersWeights;
}

export function generateMedianCalculationResult(numberOfVoters: number, feedName: string, votingRoundId: number) {
  const voters: string[] = [];
  const feedValues: ValueWithDecimals[] = [];

  const weights: bigint[] = [];

  for (let j = 0; j < numberOfVoters; j++) {
    const valueWithDecimal: ValueWithDecimals = {
      isEmpty: !(j % 13),
      value: 1000 + (j % 50),
      decimals: 2,
    };
    voters.push(generateAddress(`${j}`));
    feedValues.push(valueWithDecimal);
    weights.push(100n + BigInt(j));
  }

  const data = calculateMedian(voters, feedValues, weights, 2);

  const feed: Feed = {
    name: generateFeedName(feedName),
    decimals: 2,
  };

  const medianCalculationResult: MedianCalculationResult = {
    votingRoundId,
    feed,
    voters,
    feedValues,
    data,
    weights,
    totalVotingWeight: weights.reduce((a, b) => a + b, 0n),
  };

  return medianCalculationResult;
}
