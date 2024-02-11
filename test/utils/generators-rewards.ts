import { EntityManager } from "typeorm";
import Web3 from "web3";
import { encodeCommitPayloadMessage, encodeRevealPayloadMessage } from "../../apps/ftso-data-provider/src/response-encoders";
import { IPayloadMessage } from "../../libs/fsp-utils/src/PayloadMessage";
import { ISigningPolicy, SigningPolicy } from "../../libs/fsp-utils/src/SigningPolicy";
import { BURN_ADDRESS, CONTRACTS, EPOCH_SETTINGS, FIRST_DATABASE_INDEX_STATE, FTSO2_PROTOCOL_ID, GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC, LAST_CHAIN_INDEX_STATE, LAST_DATABASE_INDEX_STATE } from "../../libs/ftso-core/src/configs/networks";

import FakeTimers from "@sinonjs/fake-timers";
import { writeFileSync } from "fs";
import { ContractMethodNames } from "../../libs/ftso-core/src/configs/contracts";
import {
  InflationRewardsOffered,
  RandomAcquisitionStarted,
  RewardEpochStarted,
  RewardOffers,
  RewardsOffered,
  SigningPolicyInitialized,
  VotePowerBlockSelected,
  VoterRegistered,
  VoterRegistrationInfo
} from "../../libs/ftso-core/src/events";
import { TLPEvents, TLPState, TLPTransaction } from "../../libs/ftso-core/src/orm/entities";
import { RandomVoterSelector } from "../../libs/ftso-core/src/reward-calculation/RandomVoterSelector";
import { CommitData, ICommitData } from "../../libs/ftso-core/src/utils/CommitData";
import { EncodingUtils } from "../../libs/ftso-core/src/utils/EncodingUtils";
import { FeedValueEncoder } from "../../libs/ftso-core/src/utils/FeedValueEncoder";
import { ILogger } from "../../libs/ftso-core/src/utils/ILogger";
import { IRevealData } from "../../libs/ftso-core/src/utils/RevealData";
import { ClaimType, IRewardClaim } from "../../libs/ftso-core/src/utils/RewardClaim";
import { Feed } from "../../libs/ftso-core/src/voting-types";
import { TestVoter, generateEvent, generateState, generateTx } from "./basic-generators";
import { MiniFinalizer } from "./mini-finalizer/MiniFinalizer";
import { MiniFtsoCalculator } from "./mini-ftso-calculator/MiniFtsoCalculator";
import { FSPSettings } from "./test-epoch-settings";

const encodingUtils = EncodingUtils.instance;
const sigCommit = encodingUtils.getFunctionSignature(CONTRACTS.Submission.name, ContractMethodNames.submit1);
const sigReveal = encodingUtils.getFunctionSignature(CONTRACTS.Submission.name, ContractMethodNames.submit2);
const sigSignature = encodingUtils.getFunctionSignature(CONTRACTS.Submission.name, ContractMethodNames.submitSignatures);
const relaySignature = encodingUtils.getFunctionSignature(CONTRACTS.Relay.name, ContractMethodNames.relay);

const FINALIZATION_VOTER_SELECTION_WEIGHT_THRESHOLD_BIPS = 2000; // 20%
export interface IndexerPosition<T> {
  block: number;
  timestamp: number;
  data: T[];
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
  // commitRevealSelectorFunction: (votingRoundId: number, voterIndex: number, allRevealData: IRevealData) => IRevealData[],
  // signatureSelection: (votingRoundId: number, voterIndex: number, allSignatureData: any) => any,
  logger: ILogger,
): Promise<FakeTimers.InstalledClock> {
  const previousRewardEpochId = rewardEpochId - 1;
  const previousRewardEpochStartSec = EPOCH_SETTINGS().expectedRewardEpochStartTimeSec(rewardEpochId - 1);
  const rewardEpochStartSec = EPOCH_SETTINGS().expectedRewardEpochStartTimeSec(rewardEpochId);
  const randomAcquisitionStartSec = rewardEpochStartSec - fspSettings.newSigningPolicyInitializationStartSeconds;
  let entities: (TLPEvents | TLPTransaction)[] = [];
  let block = 0;
  let timestamp = previousRewardEpochStartSec - 20;
  let clock = FakeTimers.install({ now: timestamp * 1000 });

  function mineBlock() {
    block++;
    timestamp++;
    clock.setSystemTime(timestamp * 1000);
  }

  function update(pos: IndexerPosition<TLPEvents | TLPTransaction>) {
    if (pos.block - block < 0 || pos.timestamp - timestamp !== pos.block - block) {
      throw new Error("update::Invalid position");
    }
    block = pos.block;
    timestamp = pos.timestamp;
    clock.setSystemTime(timestamp * 1000);
  }

  function moveTo(time: number) {
    block = time - timestamp + block;
    timestamp = time;
    clock.setSystemTime(timestamp * 1000);
  }

  function reset(blockNumber: number, time: number) {
    block = blockNumber;
    timestamp = time;
    clock.setSystemTime(timestamp * 1000);
  }

  async function mineFakeTransaction() {
    const tx = generateTx(
      BURN_ADDRESS,
      BURN_ADDRESS,
      sigReveal,
      block,
      timestamp,
      sigReveal
    );
    mineBlock();
    await entityManager.save([tx]);
    await updateUpperState();
  }

  function generateSigningPolicy(voters: TestVoter[], rewardEpochId: number) {
    const weightSum = voters.reduce((sum, v) => sum + Number(v.registrationWeight), 0);
    const newWeightsNormalized = voters.map(v => Math.floor(Number(v.registrationWeight) / weightSum * (2 ** 16 - 1)));
    const newWeightSum = newWeightsNormalized.reduce((sum, w) => sum + w, 0);
    const threshold = Math.floor(fspSettings.signingPolicyThresholdPPM * newWeightSum / 1000000);
    const signingPolicy: ISigningPolicy = {
      rewardEpochId,
      startVotingRoundId: EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpochId),
      threshold: threshold,
      seed: "0x1234567890123456789012345678901234567890123456789012345678901234",
      voters: voters.map(v => v.signingAddress),
      weights: newWeightsNormalized,
    };
    return signingPolicy;
  }

  function updateUpperState() {
    const upperState = generateState(LAST_DATABASE_INDEX_STATE, 1, block, timestamp);
    const lastState = generateState(LAST_CHAIN_INDEX_STATE, 2, block, timestamp);
    return entityManager.save([upperState, lastState]);
  }

  ////////// START OF DATABASE GENERATION //////////

  // mine few fake transactions before the start of the previous reward epoch
  await mineFakeTransaction();
  // put it even lower, so we have enough history
  const rewardEpochDurationSec = EPOCH_SETTINGS().votingEpochDurationSeconds * EPOCH_SETTINGS().rewardEpochDurationInVotingEpochs;
  // set state to ensure sufficient indexer history
  const lowerState = generateState(FIRST_DATABASE_INDEX_STATE, 0, block - rewardEpochDurationSec, timestamp - rewardEpochDurationSec);
  await entityManager.save([lowerState]);

  await mineFakeTransaction();

  const oldSigningPolicy = generateSigningPolicy(voters, previousRewardEpochId);

  // emit signing policy for previous reward epoch
  entities.push(
    generateEvent(
      CONTRACTS.Relay,
      SigningPolicyInitialized.eventName,
      new SigningPolicyInitialized({
        rewardEpochId: oldSigningPolicy.rewardEpochId,
        startVotingRoundId: oldSigningPolicy.startVotingRoundId,
        threshold: oldSigningPolicy.threshold,
        seed: BigInt(oldSigningPolicy.seed),
        voters: oldSigningPolicy.voters,
        weights: oldSigningPolicy.weights,
        signingPolicyBytes: SigningPolicy.encode(oldSigningPolicy),
        timestamp,
      }),
      block,
      timestamp
    )
  )

  await mineFakeTransaction();

  // Emit RewardEpochStarted for previous reward epoch
  moveTo(previousRewardEpochStartSec);
  entities.push(
    generateEvent(
      CONTRACTS.FlareSystemManager,
      RewardEpochStarted.eventName,
      new RewardEpochStarted({
        rewardEpochId: previousRewardEpochId,
        startVotingRoundId: EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(previousRewardEpochId),
        timestamp: timestamp,
      }),
      block,
      timestamp
    )
  );

  mineBlock();

  // Reward offers for next reward epoch
  const offersPos = offersForFeeds(rewardEpochId, feeds, offerAmount, block, timestamp);
  entities.push(...offersPos.data);
  update(offersPos);
  await mineFakeTransaction();
  await mineFakeTransaction();
  const votePowerBlock = block;  // some choice of vote power block
  await mineFakeTransaction();
  await mineFakeTransaction();

  moveTo(randomAcquisitionStartSec);

  // Emit RandomAcquisitionStarted
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

  // Emit VotePowerBlockSelected
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

  // Emulate Voter registration
  for (const voter of voters) {
    entities.push(
      generateEvent(
        CONTRACTS.FlareSystemCalculator,
        VoterRegistrationInfo.eventName,
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
        VoterRegistered.eventName,
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

  const signingPolicy = generateSigningPolicy(voters, rewardEpochId);

  entities.push(
    generateEvent(
      CONTRACTS.Relay,
      SigningPolicyInitialized.eventName,
      new SigningPolicyInitialized({
        rewardEpochId: signingPolicy.rewardEpochId,
        startVotingRoundId: signingPolicy.startVotingRoundId,
        threshold: signingPolicy.threshold,
        seed: BigInt(signingPolicy.seed),
        voters: signingPolicy.voters,
        weights: signingPolicy.weights,
        signingPolicyBytes: SigningPolicy.encode(signingPolicy),
        timestamp,
      }),
      block,
      timestamp
    )
  );
  mineBlock();

  moveTo(rewardEpochStartSec);
  entities.push(
    generateEvent(
      CONTRACTS.FlareSystemManager,
      RewardEpochStarted.eventName,
      new RewardEpochStarted({
        rewardEpochId: rewardEpochId,
        startVotingRoundId: EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpochId),
        timestamp: timestamp,
      }),
      block,
      timestamp
    )
  )
  mineBlock();

  await entityManager.save(entities);
  await updateUpperState();
  entities = [];


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

  function moveToVotingEpochOffset(votingRoundId: number, offset: number) {
    if (offset < 0 || offset % 1 !== 0) {
      throw new Error("moveToVotingRoundOffset::Offset must be a non-negative integer");
    }
    const newTimestamp = EPOCH_SETTINGS().votingEpochStartSec(votingRoundId) + offset;
    if (timestamp > newTimestamp) {
      throw new Error(`moveToVotingRoundOffset::Timestamp is too high. Current: ${timestamp}, desired: ${newTimestamp}`);
    }
    moveTo(newTimestamp);
  }

  const voterSelector = new RandomVoterSelector(
    signingPolicy.voters,
    signingPolicy.weights.map(n => BigInt(n)),
    FINALIZATION_VOTER_SELECTION_WEIGHT_THRESHOLD_BIPS
  );

  const voterIndexToMiniFTSOCalculator = new Map<number, MiniFtsoCalculator>();
  const voterIndexToMiniFinalizer = new Map<number, MiniFinalizer>();
  for (let voterIndex = 0; voterIndex < voters.length; voterIndex++) {
    const voter = voters[voterIndex];
    const calculator = new MiniFtsoCalculator(voterIndex, voter.signingPrivateKey, entityManager, logger)
    voterIndexToMiniFTSOCalculator.set(voterIndex, calculator);
    const finalizer = new MiniFinalizer(voter, voterIndex, voterSelector, entityManager, logger);
    voterIndexToMiniFinalizer.set(voterIndex, finalizer);
  }
  console.log(`STARTING WITH: ${signingPolicy.startVotingRoundId}`)
  // move to the start of the reward epoch

  const lastVotingEpochId = signingPolicy.startVotingRoundId + EPOCH_SETTINGS().rewardEpochDurationInVotingEpochs - 1;
  for (let votingEpochId = signingPolicy.startVotingRoundId; votingEpochId <= lastVotingEpochId + 1; votingEpochId++) {
    if (votingEpochId === lastVotingEpochId) {
      // emit signing policy for the next reward epoch (not proper, just to have it)
      const nextRewaredEpochId = rewardEpochId + 1;
      const nextSigningPolicy = generateSigningPolicy(voters, nextRewaredEpochId);
      const event = generateEvent(
        CONTRACTS.Relay,
        SigningPolicyInitialized.eventName,
        new SigningPolicyInitialized({
          rewardEpochId: nextSigningPolicy.rewardEpochId,
          startVotingRoundId: nextSigningPolicy.startVotingRoundId,
          threshold: nextSigningPolicy.threshold,
          seed: BigInt(nextSigningPolicy.seed),
          voters: nextSigningPolicy.voters,
          weights: nextSigningPolicy.weights,
          signingPolicyBytes: SigningPolicy.encode(nextSigningPolicy),
          timestamp,
        }),
        block,
        timestamp
      );
      await entityManager.save([event]);
      await updateUpperState();
    }

    // start of voting round
    moveToVotingEpochOffset(votingEpochId, 1);
    await mineFakeTransaction();

    const startBlock = block;
    const startTime = timestamp;
    const commitStartOffset = Math.floor(EPOCH_SETTINGS().votingEpochDurationSeconds * 0.5);
    const signatureStartOffset = EPOCH_SETTINGS().revealDeadlineSeconds + 1;

    // const signatureDuration = Math.floor(EPOCH_SETTINGS().votingEpochDurationSeconds * 0.2);
    const finalizationStartOffset = EPOCH_SETTINGS().revealDeadlineSeconds + 1 + GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC();
    const finalizationStartDeadline = EPOCH_SETTINGS().votingEpochStartSec(votingEpochId) + finalizationStartOffset;

    // REVEALS
    if (votingEpochId > signingPolicy.startVotingRoundId) {
      console.log(`REVEALS ${votingEpochId - 1}`);
      const lastRevealTime = EPOCH_SETTINGS().votingEpochStartSec(votingEpochId) + EPOCH_SETTINGS().revealDeadlineSeconds - 2;
      if (timestamp >= lastRevealTime) {
        throw new Error("Last reveal time too late");
      }
      // Time is already correctly set for reveals
      for (let voterIndex = 0; voterIndex < voters.length; voterIndex++) {
        const voter = voters[voterIndex];
        const voterRevealData = getFromRevealsMap(votingEpochId - 1, voterIndex);
        if (!voterRevealData) {
          throw new Error(`No reveal data for voter: ${voterIndex}`);
        }
        const msg: IPayloadMessage<IRevealData> = {
          protocolId: FTSO2_PROTOCOL_ID,
          votingRoundId: votingEpochId - 1,
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
      moveToVotingEpochOffset(votingEpochId, EPOCH_SETTINGS().revealDeadlineSeconds + 1);
      await mineFakeTransaction();
      await updateUpperState();
      entities = [];
    }

    // SIGNATURES
    if (votingEpochId > signingPolicy.startVotingRoundId) {
      console.log(`SIGNATURES ${votingEpochId - 1}`);
      moveToVotingEpochOffset(votingEpochId, signatureStartOffset + 1);
      for (let voterIndex = 0; voterIndex < voters.length; voterIndex++) {
        const voter = voters[voterIndex];
        const calculator = voterIndexToMiniFTSOCalculator.get(voterIndex);
        const payload = await calculator.getSignaturePayload(votingEpochId - 1);
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
        if (timestamp < finalizationStartDeadline - 1) {
          mineBlock();
        }
      }
      // Generate calculation data per each voter
      // Calculate medians
      await entityManager.save(entities);
      await updateUpperState();
      entities = [];
    }

    // FINALIZATIONS
    if (votingEpochId > signingPolicy.startVotingRoundId) {
      console.log(`FINALIZATIONS ${votingEpochId - 1}`);
      const lastFinalizationTime = EPOCH_SETTINGS().votingEpochEndSec(votingEpochId);
      if (timestamp >= lastFinalizationTime) {
        throw new Error("Last finalization timestamp is too high");
      }

      moveToVotingEpochOffset(votingEpochId, finalizationStartOffset);

      // if (votingEpochId > signingPolicy.startVotingRoundId) {
      //   await extractIndexerToCSV(entityManager, voters, `test-${votingEpochId}.csv`);
      // }

      for (let voterIndex = 0; voterIndex < voters.length; voterIndex++) {
        const finalizer = voterIndexToMiniFinalizer.get(voterIndex);
        const tx = await finalizer.processFinalization(votingEpochId - 1, block, timestamp);
        if (tx) {
          entities.push(tx);
        }
        if (timestamp < lastFinalizationTime) {
          mineBlock();
        }
      }
      await entityManager.save(entities);
      await updateUpperState();
      entities = [];
    }
    // COMMITS
    if (votingEpochId < signingPolicy.startVotingRoundId + EPOCH_SETTINGS().votingEpochDurationSeconds - 1) {
      console.log(`COMMITS ${votingEpochId}`);
      reset(startBlock, startTime);
      const lastCommitTime = EPOCH_SETTINGS().votingEpochEndSec(votingEpochId);
      if (timestamp >= lastCommitTime) {
        throw new Error("Timestamp is too high");
      }
      moveToVotingEpochOffset(votingEpochId, commitStartOffset);

      for (let voterIndex = 0; voterIndex < voters.length; voterIndex++) {
        const voter = voters[voterIndex];
        const feedValues = valueFunction(votingEpochId, voterIndex, feeds);
        const feedEncoded = FeedValueEncoder.encode(feedValues, feeds);
        const voterRevealData: IRevealData = {
          random: Web3.utils.randomHex(32),
          feeds,
          prices: feedValues,
          encodedValues: feedEncoded
        };
        insertIntoRevealsMap(votingEpochId, voterIndex, voterRevealData);

        const hash = CommitData.hashForCommit(voter.submitAddress, voterRevealData.random, voterRevealData.encodedValues);
        const commitData: ICommitData = {
          commitHash: hash,
        };
        const msg: IPayloadMessage<ICommitData> = {
          protocolId: FTSO2_PROTOCOL_ID,
          votingRoundId: votingEpochId,
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
      await updateUpperState();
      entities = [];
    }
  }
  // Move beyond the last relevant voting epoch
  moveToVotingEpochOffset(lastVotingEpochId + 2, 1);
  mineFakeTransaction();
  return clock;
}

export interface IndexerObject {
  block_number: number;
  timestamp: number;
}

export function getVoterToIndexMap(voters: TestVoter[]): Map<string, number> {
  const voterToIndexMap = new Map<string, number>();
  for (let i = 0; i < voters.length; i++) {
    voterToIndexMap.set(voters[i].submitAddress.toLowerCase(), i);
    voterToIndexMap.set(voters[i].submitSignaturesAddress.toLowerCase(), i);
    voterToIndexMap.set(voters[i].signingAddress.toLowerCase(), i);
    voterToIndexMap.set(voters[i].identityAddress.toLowerCase(), i);
  }
  return voterToIndexMap;
}

function votingEpoch(timestamp: number) {
  return EPOCH_SETTINGS().votingEpochForTimeSec(timestamp);
}
function rewardEpoch(timestamp: number) {
  try {
    return EPOCH_SETTINGS().rewardEpochForTimeSec(timestamp)
  } catch (e) {
    return "-";
  }
}

// String of form (and meaning)
// - Rev - reveal
// - GS - grace period for signatures
// - GF - grace period for finalization
// - C  - beyond grace period for finalization
function votingEpochPosition(timestamp: number) {
  const votingEpochId = EPOCH_SETTINGS().votingEpochForTimeSec(timestamp);
  const offset = timestamp - EPOCH_SETTINGS().votingEpochStartSec(votingEpochId);
  if (offset <= EPOCH_SETTINGS().revealDeadlineSeconds) {
    return `Rev`;
  }
  if (offset <= EPOCH_SETTINGS().revealDeadlineSeconds + GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC()) {
    return `GS`;
  }
  if (offset <= EPOCH_SETTINGS().revealDeadlineSeconds + GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC() + GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC()) {
    return `GF`;
  }
  return `C`;
}

export function parseEventSummary(event: TLPEvents, voterToIndexMap: Map<string, number>): string {
  const eventAddress = "0x" + event.address.toLowerCase();
  if (eventAddress === CONTRACTS.FlareSystemManager.address.toLowerCase()) {
    if ("0x" + event.topic0 === encodingUtils.getEventSignature(CONTRACTS.FlareSystemManager.name, RandomAcquisitionStarted.eventName)) {
      const parsedEvent = RandomAcquisitionStarted.fromRawEvent(event)
      return `${event.timestamp};${event.block_number};${votingEpoch(event.timestamp)};${rewardEpoch(event.timestamp)};RandomAcquisitionStarted;rewardEpochId: ${parsedEvent.rewardEpochId}`;
    }
    if ("0x" + event.topic0 === encodingUtils.getEventSignature(CONTRACTS.FlareSystemManager.name, VotePowerBlockSelected.eventName)) {
      const parsedEvent = VotePowerBlockSelected.fromRawEvent(event)
      return `${event.timestamp};${event.block_number};${votingEpoch(event.timestamp)};${rewardEpoch(event.timestamp)};VotePowerBlockSelected;rewardEpochId: ${parsedEvent.rewardEpochId}`;
    }

    if ("0x" + event.topic0 === encodingUtils.getEventSignature(CONTRACTS.FlareSystemManager.name, RewardEpochStarted.eventName)) {
      const parsedEvent = RewardEpochStarted.fromRawEvent(event)
      return `${event.timestamp};${event.block_number};${votingEpoch(event.timestamp)};${rewardEpoch(event.timestamp)};RewardEpochStarted;rewardEpochId: ${parsedEvent.rewardEpochId}`;
    }
  }
  if (eventAddress === CONTRACTS.VoterRegistry.address.toLowerCase()) {
    if ("0x" + event.topic0 === encodingUtils.getEventSignature(CONTRACTS.VoterRegistry.name, VoterRegistered.eventName)) {
      const parsedEvent = VoterRegistered.fromRawEvent(event)
      return `${event.timestamp};${event.block_number};${votingEpoch(event.timestamp)};${rewardEpoch(event.timestamp)};VoterRegistered;rewardEpochId: ${parsedEvent.rewardEpochId};voter: ${voterToIndexMap.get(parsedEvent.voter.toLowerCase())}`;
    }
  }
  if (eventAddress === CONTRACTS.FlareSystemCalculator.address.toLowerCase()) {
    if ("0x" + event.topic0 === encodingUtils.getEventSignature(CONTRACTS.FlareSystemCalculator.name, VoterRegistrationInfo.eventName)) {
      const parsedEvent = VoterRegistrationInfo.fromRawEvent(event)
      return `${event.timestamp};${event.block_number};${votingEpoch(event.timestamp)};${rewardEpoch(event.timestamp)};VoterRegistrationInfo;rewardEpochId: ${parsedEvent.rewardEpochId};voter: ${voterToIndexMap.get(parsedEvent.voter.toLowerCase())}`;
    }
  }
  if (eventAddress === CONTRACTS.Relay.address.toLowerCase()) {
    if ("0x" + event.topic0 === encodingUtils.getEventSignature(CONTRACTS.Relay.name, SigningPolicyInitialized.eventName)) {
      const parsedEvent = SigningPolicyInitialized.fromRawEvent(event)
      return `${event.timestamp};${event.block_number};${votingEpoch(event.timestamp)};${rewardEpoch(event.timestamp)};SigningPolicyInitialized;rewardEpochId: ${parsedEvent.rewardEpochId}`;
    }
  }
  if (eventAddress === CONTRACTS.FtsoRewardOffersManager.address.toLowerCase()) {
    if ("0x" + event.topic0 === encodingUtils.getEventSignature(CONTRACTS.FtsoRewardOffersManager.name, RewardsOffered.eventName)) {
      const parsedEvent = RewardsOffered.fromRawEvent(event)
      return `${event.timestamp};${event.block_number};${votingEpoch(event.timestamp)};${rewardEpoch(event.timestamp)};RewardsOffered;rewardEpochId: ${parsedEvent.rewardEpochId}`;
    }
    if ("0x" + event.topic0 === encodingUtils.getEventSignature(CONTRACTS.FtsoRewardOffersManager.name, InflationRewardsOffered.eventName)) {
      const parsedEvent = InflationRewardsOffered.fromRawEvent(event)
      return `${event.timestamp};${event.block_number};${votingEpoch(event.timestamp)};${rewardEpoch(event.timestamp)};InflationRewardsOffered;rewardEpochId: ${parsedEvent.rewardEpochId}`;
    }

  }
  return `${event.timestamp};${event.block_number};${votingEpoch(event.timestamp)};${rewardEpoch(event.timestamp)};Unknown Event;${eventAddress} ${event.topic0}`;
}

export function parseTransactionSummary(tx: TLPTransaction, voterToIndexMap: Map<string, number>) {
  const toAddress = "0x" + tx.to_address.toLowerCase();
  const fromAddress = "0x" + tx.from_address.toLowerCase();
  if (toAddress === CONTRACTS.Submission.address.toLowerCase()) {
    if (tx.input.startsWith(sigCommit.slice(2))) {
      return `${tx.timestamp};${tx.block_number};${votingEpoch(tx.timestamp)};${rewardEpoch(tx.timestamp)};${votingEpochPosition(tx.timestamp)};TxCommit;voter: ${voterToIndexMap.get(fromAddress)};status: ${tx.status}`;
    }
    if (tx.input.startsWith(sigReveal.slice(2))) {
      return `${tx.timestamp};${tx.block_number};${votingEpoch(tx.timestamp)};${rewardEpoch(tx.timestamp)};${votingEpochPosition(tx.timestamp)};TxReveal;voter: ${voterToIndexMap.get(fromAddress)};status: ${tx.status}`;
    }
    if (tx.input.startsWith(sigSignature.slice(2))) {
      return `${tx.timestamp};${tx.block_number};${votingEpoch(tx.timestamp)};${rewardEpoch(tx.timestamp)};${votingEpochPosition(tx.timestamp)};TxSignature;voter: ${voterToIndexMap.get(fromAddress)};status: ${tx.status}`;
    }
  }
  if (toAddress === CONTRACTS.Relay.address.toLowerCase()) {
    if (tx.input.startsWith(relaySignature.slice(2))) {
      return `${tx.timestamp};${tx.block_number};${votingEpoch(tx.timestamp)};${rewardEpoch(tx.timestamp)};${votingEpochPosition(tx.timestamp)};TxRelay;voter: ${voterToIndexMap.get(fromAddress)};status: ${tx.status}`;
    }
  }
  if (toAddress === BURN_ADDRESS.toLowerCase() && fromAddress === BURN_ADDRESS.toLowerCase()) {
    return `${tx.timestamp};${tx.block_number};${votingEpoch(tx.timestamp)};${rewardEpoch(tx.timestamp)};${votingEpochPosition(tx.timestamp)};TxFake`;
  }
  return `${tx.timestamp};${tx.block_number};${votingEpoch(tx.timestamp)};${rewardEpoch(tx.timestamp)};${votingEpochPosition(tx.timestamp)};Unknown TX;to address: ${toAddress}; input: ${tx.input};status: ${tx.status}`;
}

export async function printSummary(entityManager: EntityManager, voters: TestVoter[], filename?: string) {
  const voterToIndexMap = getVoterToIndexMap(voters)
  const state = await entityManager.getRepository(TLPState)
    .createQueryBuilder("state")
    .getMany();
  const events = await entityManager.getRepository(TLPEvents)
    .createQueryBuilder("event")
    .addOrderBy("event.block_number", "ASC")
    .addOrderBy("event.log_index", "ASC")
    .getMany();
  const transactions = await entityManager.getRepository(TLPTransaction)
    .createQueryBuilder("tx")
    .addOrderBy("tx.block_number", "ASC")
    .addOrderBy("tx.transaction_index", "ASC")
    .getMany();
  let i = 0;
  let j = 0;
  let text = "";
  const sortedSequence = [];
  for (const stateRows of state) {
    text += `STATE;${stateRows.name}; block: ${stateRows.index}; timestamp: ${stateRows.block_timestamp}\n`;
  }
  while (i < events.length && j < transactions.length) {
    if (events[i].block_number <= transactions[j].block_number) {
      sortedSequence.push(events[i]);
      i++;
    } else {
      sortedSequence.push(transactions[j]);
      j++;
    }
  }
  if (i < events.length) {
    for (let k = i; k < events.length; k++) {
      sortedSequence.push(events[k]);
    }
  }
  if (j < transactions.length) {
    for (let k = j; k < transactions.length; k++) {
      sortedSequence.push(transactions[k]);
    }
  }

  text += sortedSequence.map((entity) => {
    if (entity instanceof TLPEvents) {
      return parseEventSummary(entity, voterToIndexMap);
    } else {
      return parseTransactionSummary(entity, voterToIndexMap);
    }
  }).join("\n")

  if (filename) {
    writeFileSync(filename, text);
  } else {
    console.log(text);
  }
}

function claimListSummary(beneficiary: string, voterIndex: number, isNodeId: boolean, isSigningAddress: boolean, claims: IRewardClaim[], padding = 6) {
  const feeClaim = claims.find(c => c.claimType === ClaimType.FEE);
  const fee = (feeClaim ? Number(feeClaim.amount) : 0).toString().padStart(padding);
  const wnatClaim = claims.find(c => c.claimType === ClaimType.WNAT);
  const wnat = (wnatClaim ? Number(wnatClaim.amount) : 0).toString().padStart(padding);
  const mirrorClaim = claims.find(c => c.claimType === ClaimType.MIRROR);
  const mirror = (mirrorClaim ? Number(mirrorClaim.amount) : 0).toString().padStart(padding);
  const directClaim = claims.find(c => c.claimType === ClaimType.DIRECT);
  const direct = (directClaim ? Number(directClaim.amount) : 0).toString().padStart(padding);
  const cchainClaim = claims.find(c => c.claimType === ClaimType.CCHAIN);
  const cchain = (cchainClaim ? Number(cchainClaim.amount) : 0).toString().padStart(padding);
  const indexValue = (
    voterIndex === undefined
      ? "-"
      : (
        isNodeId
          ? "n-" + voterIndex.toString()
          : (isSigningAddress
            ? "s-" + voterIndex.toString()
            : voterIndex.toString()
          )
      )).padStart(5);
  let addressText = beneficiary.slice(0, 10);
  if (beneficiary.toLowerCase() === BURN_ADDRESS.toLowerCase()) {
    addressText = "BURN ADDR ";
  }
  return `${indexValue.padStart(3)} ${addressText}: FEE: ${fee}|  WNAT: ${wnat}|  MIRROR: ${mirror}|  DIRECT: ${direct}|  CCHAIN: ${cchain}`
}

export function claimSummary(voters: TestVoter[], claims: IRewardClaim[]) {
  const voterToClaimMap = new Map<string, IRewardClaim[]>();
  const nodeIdToVoterIndex = new Map<string, number>();
  const signingAddressToVoterIndex = new Map<string, number>();
  for (let i = 0; i < voters.length; i++) {
    const voter = voters[i];
    for (const nodeId of voter.nodeIds) {
      nodeIdToVoterIndex.set(nodeId, i);
    }
    signingAddressToVoterIndex.set(voter.signingAddress.toLowerCase(), i);
  }
  let totalValue = 0n;
  let burned = 0n;
  for (const claim of claims) {
    totalValue += claim.amount;
    const beneficiary = claim.beneficiary.toLowerCase();
    if (beneficiary.toLowerCase() === BURN_ADDRESS.toLowerCase()) {
      burned += claim.amount;
    }
    const claimList = voterToClaimMap.get(beneficiary) || [];
    claimList.push(claim);
    voterToClaimMap.set(beneficiary, claimList);
  }
  const allVoters = new Set<string>();
  for (const voter of voters) {
    allVoters.add(voter.delegationAddress.toLowerCase());
  }
  const nonVoterAddresses = new Set<string>();
  for (const claim of claims) {
    const beneficiary = claim.beneficiary.toLowerCase();
    if (!allVoters.has(beneficiary)) {
      nonVoterAddresses.add(beneficiary);
    }
  }
  console.log("CLAIM SUMMARY");
  console.log("Total value: ", totalValue.toString());
  console.log("Burned value:", burned.toString());
  console.log("VOTERS:");
  for (let i = 0; i < voters.length; i++) {
    const voter = voters[i];
    const claimList = voterToClaimMap.get(voter.delegationAddress.toLowerCase()) || [];
    console.log(claimListSummary(voter.delegationAddress, i, false, false, claimList));
  }
  console.log("NON-VOTERS: (s-N is signing address, n-N is node id)")

  for (const address of nonVoterAddresses) {
    const claimList = voterToClaimMap.get(address) || [];
    let voterIndex = nodeIdToVoterIndex.get(address);
    let isNodeId = voterIndex !== undefined;
    let isSigningAddress = false;
    if (!isNodeId) {
      voterIndex = signingAddressToVoterIndex.get(address);
      isSigningAddress = voterIndex !== undefined;
    }
    console.log(claimListSummary(address, voterIndex, isNodeId, isSigningAddress, claimList));
  }
}

function voterSummary(voterIndex: number, voter: TestVoter) {
  return `Voter: ${voterIndex} del: ${voter.delegationAddress.toLowerCase().slice(0, 10)} sign: ${voter.signingAddress.toLowerCase().slice(0, 10)} sub: ${voter.submitAddress.toLowerCase().slice(0, 10)} sigSub: ${voter.submitSignaturesAddress.toLowerCase().slice(0, 10)} weight: ${voter.registrationWeight}`;
}

export function votersSummary(voters: TestVoter[]) {
  console.log("VOTER SUMMARY:")
  for (let i = 0; i < voters.length; i++) {
    const voter = voters[i];
    console.log(voterSummary(i, voter));
  }
}

export function offersSummary(offers: RewardOffers) {
  console.log("OFFERS SUMMARY:");
  let totalOffers = 0n;
  for (let offer of offers.rewardOffers) {
    totalOffers += offer.amount;
  }
  let totalInflationOffers = 0n;
  for (let offer of offers.inflationOffers) {
    totalInflationOffers += offer.amount;
  }
  console.log(`Community offers: ${offers.rewardOffers.length}, total: ${totalOffers}`);
  console.log(`Inflation offers: ${offers.inflationOffers.length}, total: ${totalInflationOffers}`);
}




