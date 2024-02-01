import { EntityManager } from "typeorm";
import Web3 from "web3";
import { encodeCommitPayloadMessage, encodeRevealPayloadMessage } from "../../apps/ftso-data-provider/src/response-encoders";
import { IPayloadMessage } from "../../libs/fsp-utils/src/PayloadMessage";
import { ISigningPolicy, SigningPolicy } from "../../libs/fsp-utils/src/SigningPolicy";
import { BURN_ADDRESS, CONTRACTS, ContractMethodNames, EPOCH_SETTINGS, FTSO2_PROTOCOL_ID } from "../../libs/ftso-core/src/configs/networks";
import {
  RandomAcquisitionStarted,
  RewardEpochStarted,
  SigningPolicyInitialized,
  VotePowerBlockSelected,
  VoterRegistered,
  VoterRegistrationInfo
} from "../../libs/ftso-core/src/events";
import { TLPEvents, TLPTransaction } from "../../libs/ftso-core/src/orm/entities";
import { CommitData, ICommitData } from "../../libs/ftso-core/src/utils/CommitData";
import { FeedValueEncoder } from "../../libs/ftso-core/src/utils/FeedValueEncoder";
import { IRevealData } from "../../libs/ftso-core/src/utils/RevealData";
import { Feed } from "../../libs/ftso-core/src/voting-types";
import { TestVoter, encodingUtils, generateEvent, generateTx } from "./generators";
import { MiniFtsoCalculator } from "./mini-ftso-calculator";

export interface EpochSettingsConfig {
  firstVotingRoundStartTs: number;
  votingEpochDurationSeconds: number;
  firstRewardEpochStartVotingRoundId: number;
  rewardEpochDurationInVotingEpochs: number;
  revealDeadlineSeconds: number;
}

export interface IndexerPosition<T> {
  block: number;
  timestamp: number;
  data: T[];
}

export interface FSPSettings {
  newSigningPolicyInitializationStartSeconds: number;
  voterRegistrationMinDurationSeconds: number; 
  signingPolicyThresholdPPM: number; 
}

export function setupEpochSettings(config: EpochSettingsConfig) {
  if (process.env.NETWORK !== "from-env") {
    throw new Error("This works only for setup from environment enabled");
  }
  process.env.ES_FIRST_VOTING_ROUND_START_TS = config.firstVotingRoundStartTs.toString();
  process.env.ES_VOTING_EPOCH_DURATION_SECONDS = config.votingEpochDurationSeconds.toString();
  process.env.ES_FIRST_REWARD_EPOCH_START_VOTING_ROUND_ID = config.firstRewardEpochStartVotingRoundId.toString();
  process.env.ES_REWARD_EPOCH_DURATION_IN_VOTING_EPOCHS = config.rewardEpochDurationInVotingEpochs.toString();
  process.env.FTSO_REVEAL_DEADLINE_SECONDS = config.revealDeadlineSeconds.toString();
}

export function voterFeedValue(votingRoundId: number, voterIndex: number, feedSequence: Feed[]): number[] {
  const feedValues = [];
  for (let i = 0; i < feedSequence.length; i++) {
    const value = Math.sin(votingRoundId / 90) * 1000 + Math.cos(voterIndex + votingRoundId / 90);
    feedValues.push(value);
  }
  return feedValues;
}

export function offersForFeeds(
  rewardEpochId: number, feeds: Feed[], amount: bigint,
  startBlock: number, startTime: number
): IndexerPosition<TLPEvents> {
  const events: TLPEvents[] = [];
  for (const [i, feed] of feeds.entries()) {
    let event = generateEvent(
      CONTRACTS.FtsoRewardOffersManager,
      "RewardsOffered",
      {
        rewardEpochId,
        feedName: feed.name,
        decimals: feed.decimals,
        amount,
        minRewardedTurnoutBIPS: 100,
        primaryBandRewardSharePPM: 10000,
        secondaryBandWidthPPM: 10000,
        claimBackAddress: BURN_ADDRESS,
      },
      startBlock + i,
      startTime + i
    );
    events.push(event);
  }
  const result: IndexerPosition<TLPEvents> = {
    block: startBlock + feeds.length,
    timestamp: startTime + feeds.length,
    data: events,
  };
  return result;
}


const defaultSigningPolicyProtocolSettings: FSPSettings = {
  newSigningPolicyInitializationStartSeconds: 40,
  voterRegistrationMinDurationSeconds: 10,
  signingPolicyThresholdPPM: 500000,
};


const realtimeShorterEpochSettings: EpochSettingsConfig = {
  firstVotingRoundStartTs: 1704250616,
  votingEpochDurationSeconds: 90,
  firstRewardEpochStartVotingRoundId: 1000,
  rewardEpochDurationInVotingEpochs: 20,
  revealDeadlineSeconds: 30,
}



// Sequence:
// - 0: RewardEpochStarted r - 1
// - 1 ... O: - offers
// - S skip time: RandomAcquisitionStarted r
// - S + 1: VotePowerBlockSelected r
// - S + 2 ... S + V + 1: VoterRegistered r
// - T skip time SigningPolicyInitialized r
// - skip: RewardEpochStarted r
// - repeat:
//      - commits  (relative interval) - percentage range
//      - reveals  (relative interval) - percentage range
// - skip: RewardEpochStarted r + 1
/**
 * given feeds, voters and voter feed generators generates all events and transactions for reward epoch calculation.
 */

export async function generateRewardEpochDataForRewardCalculation(
  entityManager: EntityManager,
  fspSettings: FSPSettings,
  feeds: Feed[],
  offerAmount: bigint,
  rewardEpochId: number,
  voters: TestVoter[],
  valueFunction: (votingRoundId: number, voterIndex: number, feedSequence: Feed[]) => number[],
  commitRevealSelectorFunction: (votingRoundId: number, voterIndex: number, allRevealData: IRevealData) => IRevealData[],
  signatureSelection: (votingRoundId: number, voterIndex: number, allSignatureData: any) => any,
) {  
  const previousRewardEpochId = rewardEpochId - 1;
  const previousRewardEpochStartSec = EPOCH_SETTINGS.expectedRewardEpochStartTimeSec(rewardEpochId - 1);
  const rewardEpochStartSec = EPOCH_SETTINGS.expectedRewardEpochStartTimeSec(rewardEpochId);
  const randomAcquisitionStartSec = rewardEpochStartSec - fspSettings.newSigningPolicyInitializationStartSeconds;
  let entities: (TLPEvents | TLPTransaction)[] = [];
  let block = 0;
  let timestamp = previousRewardEpochStartSec;

  function mineBlock() {
    block++;
    timestamp++;
  }

  function update(pos: IndexerPosition<TLPEvents | TLPTransaction>) {
    if (pos.block - block < 0 || pos.timestamp - timestamp !== pos.block - block) {
      throw new Error("update::Invalid position");
    }
    block = pos.block;
    timestamp = pos.timestamp;
  }

  function moveTo(time: number) {
    block = time - timestamp + block;
    timestamp = time;
  }

  function reset(blockNumber: number, time: number) {
    block = blockNumber;
    timestamp = time;
  }

  entities.push(
    generateEvent(
      CONTRACTS.FlareSystemManager,
      RewardEpochStarted.eventName,
      new RewardEpochStarted({
        rewardEpochId: previousRewardEpochId,
        startVotingRoundId: EPOCH_SETTINGS.expectedFirstVotingRoundForRewardEpoch(previousRewardEpochId),
        timestamp: previousRewardEpochStartSec,
      }),
      block,
      timestamp
    )
  );

  mineBlock();
  const offersPos = offersForFeeds(rewardEpochId, feeds, offerAmount, block, timestamp);
  entities.push(...offersPos.data);
  update(offersPos);
  mineBlock();
  mineBlock();
  const votePowerBlock = block;
  mineBlock();

  moveTo(randomAcquisitionStartSec);

  entities.push(
    generateEvent(
      CONTRACTS.FlareSystemManager,
      RandomAcquisitionStarted.eventName,
      new RandomAcquisitionStarted({
        rewardEpochId: rewardEpochId,
        timestamp,
      }),
      block,
      timestamp
    )
  );
  mineBlock();
  mineBlock();
  mineBlock();

  entities.push(
    generateEvent(
      CONTRACTS.FlareSystemManager,
      VotePowerBlockSelected.eventName,
      new VotePowerBlockSelected({
        rewardEpochId: rewardEpochId,
        votePowerBlock,
        timestamp
      }),
      block,
      timestamp
    )
  );

  // Voter registration
  for (const voter of voters) {
    entities.push(
      generateEvent(
        CONTRACTS.FlareSystemCalculator,
        "VoterRegistrationInfo",
        new VoterRegistrationInfo({
          rewardEpochId,
          voter: voter.identityAddress,
          wNatCappedWeight: voter.wNatCappedWeight,
          wNatWeight: voter.wNatWeight,
          nodeIds: voter.nodeIds,
          nodeWeights: voter.nodeWeights,
          delegationFeeBIPS: voter.delegationFeeBIPS,
        }),
        block,
        timestamp
      )
    );
    entities.push(
      generateEvent(
        CONTRACTS.VoterRegistry,
        "VoterRegistered",
        new VoterRegistered({
          voter: voter.identityAddress,
          rewardEpochId,
          signingPolicyAddress: voter.signingAddress,
          delegationAddress: voter.delegationAddress,
          submitAddress: voter.submitAddress,
          submitSignaturesAddress: voter.submitSignaturesAddress,
          registrationWeight: voter.registrationWeight,
        }),
        block,
        timestamp
      )
    );
    mineBlock();
  }

  const weightSum = voters.reduce((sum, v) => sum + Number(v.registrationWeight), 0);
  const newWeightsNormalized = voters.map(v => Math.floor(Number(v.registrationWeight) / weightSum * (2 ** 16 - 1)));
  const newWeightSum = newWeightsNormalized.reduce((sum, w) => sum + w, 0);
  const threshold = Math.floor(fspSettings.signingPolicyThresholdPPM * newWeightSum / 1000000);
  const signingPolicy: ISigningPolicy = {
    rewardEpochId,
    startVotingRoundId: EPOCH_SETTINGS.expectedFirstVotingRoundForRewardEpoch(rewardEpochId),
    threshold: threshold,
    seed: "0x12345678901234567890123456789012345678901234567890123456789012345678",
    voters: voters.map(v => v.signingAddress),
    weights: newWeightsNormalized,
  };
  entities.push(
    generateEvent(
      CONTRACTS.Relay,
      SigningPolicyInitialized.eventName,
      new SigningPolicyInitialized({
        rewardEpochId: signingPolicy.rewardEpochId,
        startVotingRoundId: signingPolicy.startVotingRoundId,
        threshold: signingPolicy.threshold,
        seed: signingPolicy.seed,
        voters: voters.map(v => v.signingAddress),
        weights: voters.map(v => v.registrationWeight),
        signingPolicyBytes: SigningPolicy.encode(signingPolicy),
        timestamp: previousRewardEpochStartSec + 50,
      }),
      block,
      timestamp
    )
  );
  mineBlock();

  moveTo(rewardEpochStartSec);
  mineBlock();

  await entityManager.save(entities);
  entities = [];

  const sigCommit = encodingUtils.getFunctionSignature(CONTRACTS.Submission.name, ContractMethodNames.submit1);
  const sigReveal = encodingUtils.getFunctionSignature(CONTRACTS.Submission.name, ContractMethodNames.submit2);
  const sigSignature = encodingUtils.getFunctionSignature(CONTRACTS.Submission.name, ContractMethodNames.submitSignatures);
  // votingRoundId => voterIndex => 
  const commitMap = new Map<number, Map<number, IRevealData>>();

  function insertIntoRevealsMap(votingRoundId: number, voterIndex: number, value: IRevealData) {
    if (!commitMap.has(votingRoundId)) {
      commitMap.set(votingRoundId, new Map<number, IRevealData>());
    }
    commitMap.get(votingRoundId).set(voterIndex, value);
  }

  function getFromRevealsMap(votingRoundId: number, voterIndex: number): IRevealData {
    return commitMap.get(votingRoundId).get(voterIndex);
  }

  function moveToVotingRoundOffset(votingRoundId: number, offset: number) {
    if (offset < 0 || offset % 1 !== 0) {
      throw new Error("moveToVotingRoundOffset::Offset must be a non-negative integer");
    }
    const newTimestamp = EPOCH_SETTINGS.votingEpochStartSec(votingRoundId) + offset;
    if (timestamp > newTimestamp) {
      throw new Error("moveToVotingRoundOffset::Timestamp is too high");
    }
    moveTo(newTimestamp);
  }

  const voterIndexToMiniFTSOCalculator = new Map<number, MiniFtsoCalculator>();
  for (let voterIndex = 0; voterIndex < voters.length; voterIndex++) {
    const voter = voters[voterIndex];
    const calculator = new MiniFtsoCalculator(voterIndex, voter.signingPrivateKey, entityManager)
    voterIndexToMiniFTSOCalculator.set(voterIndex, calculator);
  }
  for (let votingRoundId = signingPolicy.startVotingRoundId; votingRoundId < signingPolicy.startVotingRoundId + EPOCH_SETTINGS.votingEpochDurationSeconds; votingRoundId++) {

    // start of voting round
    moveToVotingRoundOffset(votingRoundId, 1);
    const startBlock = block;
    const startTime = timestamp;
    const commitStartOffset = Math.floor(EPOCH_SETTINGS.votingEpochDurationSeconds * 0.5);
    const signatureStartOffset = EPOCH_SETTINGS.revealDeadlineSeconds + 1;
    const signatureDuration = Math.floor(EPOCH_SETTINGS.votingEpochDurationSeconds * 0.2);

    // REVEALS
    if (votingRoundId > signingPolicy.startVotingRoundId) {
      const lastRevealTime = EPOCH_SETTINGS.votingEpochEndSec(votingRoundId) - EPOCH_SETTINGS.revealDeadlineSeconds - 2;
      if (timestamp >= lastRevealTime) {
        throw new Error("Last reveal time too late");
      }
      // Time is already correctly set for reveals
      for (let voterIndex = 0; voterIndex < voters.length; voterIndex++) {
        const voter = voters[voterIndex];
        const voterRevealData = getFromRevealsMap(votingRoundId - 1, voterIndex);
        if (!voterRevealData) {
          throw new Error(`No reveal data for voter: ${voterIndex}`);
        }
        const msg: IPayloadMessage<IRevealData> = {
          protocolId: FTSO2_PROTOCOL_ID,
          votingRoundId: votingRoundId,
          payload: voterRevealData,
        };
        const revealPayload = sigReveal + encodeRevealPayloadMessage(msg).slice(2);
        const revealTx = generateTx(
          voter.submitAddress,
          CONTRACTS.Submission.address,
          sigReveal,
          block,
          timestamp,
          revealPayload
        );
        entities.push(revealTx);
        // Increase block and timestamp, but if near the end, pack all of them into one block
        if (timestamp < lastRevealTime) {
          mineBlock();
        }
      }
      await entityManager.save(entities);
      entities = [];
    }
    // SIGNATURES
    if (votingRoundId > signingPolicy.startVotingRoundId) {
      reset(startBlock, startTime);
      moveToVotingRoundOffset(votingRoundId, signatureStartOffset);
      for(let voterIndex = 0; voterIndex < voters.length; voterIndex++) {
        const voter = voters[voterIndex];
        const calculator = voterIndexToMiniFTSOCalculator.get(voterIndex);
        const payload = await calculator.getSignaturePayload(votingRoundId);
        const signaturePayload = sigSignature + payload.slice(2);
        const signatureTx = generateTx(
          voter.submitSignaturesAddress,
          CONTRACTS.Submission.address,
          sigSignature,
          block,
          timestamp,
          signaturePayload
        );
        entities.push(signatureTx);
        // Increase block and timestamp, but if near the end, pack all of them into one block
        if (timestamp < EPOCH_SETTINGS.votingEpochEndSec(votingRoundId) - 1) {
          mineBlock();
        }
      }     
      // Generate calculation data per each voter
      // Calculate medians
      await entityManager.save(entities);
      entities = [];
    }

    // FINALIZATIONS
    if (votingRoundId > signingPolicy.startVotingRoundId) {
      await entityManager.save(entities);
      entities = [];
      // TODO: Copy an adapt Mock Finalizers
    }
    // COMMITS
    if (votingRoundId < signingPolicy.startVotingRoundId + EPOCH_SETTINGS.votingEpochDurationSeconds - 1) {
      const lastCommitTime = EPOCH_SETTINGS.votingEpochEndSec(votingRoundId);
      if (timestamp >= lastCommitTime) {
        throw new Error("Timestamp is too high");
      }
      moveToVotingRoundOffset(votingRoundId, commitStartOffset);

      for (let voterIndex = 0; voterIndex < voters.length; voterIndex++) {
        const voter = voters[voterIndex];
        const feedValues = valueFunction(votingRoundId, voterIndex, feeds);
        const feedEncoded = FeedValueEncoder.encode(feedValues, feeds);
        const voterRevealData: IRevealData = {
          random: Web3.utils.randomHex(32),
          feeds,
          prices: feedValues,
          encodedValues: feedEncoded
        };
        insertIntoRevealsMap(votingRoundId, voterIndex, voterRevealData);

        const hash = CommitData.hashForCommit(voter.submitAddress, voterRevealData.random, voterRevealData.encodedValues);
        const commitData: ICommitData = {
          commitHash: hash,
        };
        const msg: IPayloadMessage<ICommitData> = {
          protocolId: FTSO2_PROTOCOL_ID,
          votingRoundId,
          payload: commitData,
        };

        const payloadMessages = encodeCommitPayloadMessage(msg);
        const commitPayload = sigCommit + payloadMessages.slice(2);
        const commitTx = generateTx(
          voter.submitAddress,
          CONTRACTS.Submission.address,
          sigCommit,
          block,
          timestamp,
          commitPayload
        );
        entities.push(commitTx);
        // Increase block and timestamp, but if near the end, pack all of them into one block
        if (timestamp < lastCommitTime) {
          mineBlock();
        }
      }
      await entityManager.save(entities);
      entities = [];
    }
  }
}
