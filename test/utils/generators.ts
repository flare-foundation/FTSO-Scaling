import Web3 from "web3";
import { CONTRACTS } from "../../libs/ftso-core/src/configs/networks";
import {
  RandomAcquisitionStarted,
  RewardEpochStarted,
  SigningPolicyInitialized,
  VotePowerBlockSelected,
  VoterRegistered,
  VoterRegistrationInfo,
} from "../../libs/ftso-core/src/events";
import { TLPEvents } from "../../libs/ftso-core/src/orm/entities";
import { EncodingUtils } from "../../libs/ftso-core/src/utils/EncodingUtils";
import { EpochSettings } from "../../libs/ftso-core/src/utils/EpochSettings";
import { Feed } from "../../libs/ftso-core/src/voting-types";
import { generateRandomAddress } from "./testRandom";
import { TestVoter, generateEvent } from "./basic-generators";

export const encodingUtils = EncodingUtils.instance;
const burnAddress = generateRandomAddress();
export const web3 = new Web3("https://dummy");

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


export function currentTimeSec(): number {
  return Math.floor(Date.now() / 1000);
}
