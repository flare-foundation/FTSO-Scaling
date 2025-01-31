import { EntityManager } from "typeorm";
import Web3 from "web3";
import {
  encodeCommitPayloadMessage,
  encodeRevealPayloadMessage,
} from "../../apps/ftso-data-provider/src/response-encoders";
import {
  EPOCH_SETTINGS,
  FIRST_DATABASE_INDEX_STATE,
  FTSO2_PROTOCOL_ID,
  LAST_CHAIN_INDEX_STATE,
  LAST_DATABASE_INDEX_STATE,
} from "../../libs/ftso-core/src/constants";
import { IPayloadMessage } from "../../libs/ftso-core/src/fsp-utils/PayloadMessage";
import { ISigningPolicy, SigningPolicy } from "../../libs/ftso-core/src/fsp-utils/SigningPolicy";

import FakeTimers from "@sinonjs/fake-timers";
import { AbiCache } from "../../libs/contracts/src/abi/AbiCache";
import { CONTRACTS } from "../../libs/contracts/src/constants";
import { ContractMethodNames } from "../../libs/contracts/src/definitions";
import {
  RandomAcquisitionStarted,
  RewardEpochStarted,
  SigningPolicyInitialized,
  VotePowerBlockSelected,
  VoterRegistered,
  VoterRegistrationInfo,
} from "../../libs/contracts/src/events";
import {
  BURN_ADDRESS,
  FINALIZATION_VOTER_SELECTION_THRESHOLD_WEIGHT_BIPS,
  GRACE_PERIOD_FOR_FINALIZATION_DURATION_SEC, GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC, ZERO_BYTES32
} from "../../libs/fsp-rewards/src/constants";
import { RandomVoterSelector } from "../../libs/fsp-rewards/src/reward-calculation/RandomVoterSelector";
import { CommitData, ICommitData } from "../../libs/ftso-core/src/data/CommitData";
import { FeedValueEncoder } from "../../libs/ftso-core/src/data/FeedValueEncoder";
import { IRevealData } from "../../libs/ftso-core/src/data/RevealData";
import { TLPEvents, TLPTransaction } from "../../libs/ftso-core/src/orm/entities";
import { ILogger, emptyLogger } from "../../libs/ftso-core/src/utils/ILogger";
import { EpochResult, Feed } from "../../libs/ftso-core/src/voting-types";
import { TestVoter, generateEvent, generateState, generateTx } from "./basic-generators";
import { MiniFinalizer } from "./mini-finalizer/MiniFinalizer";
import { MiniFtsoCalculator } from "./mini-ftso-calculator/MiniFtsoCalculator";
import { FSPSettings } from "./test-epoch-settings";

export const encodingUtils = AbiCache.instance;
export const sigCommit = encodingUtils.getFunctionSignature(CONTRACTS.Submission.name, ContractMethodNames.submit1);
export const sigReveal = encodingUtils.getFunctionSignature(CONTRACTS.Submission.name, ContractMethodNames.submit2);
export const sigSignature = encodingUtils.getFunctionSignature(
  CONTRACTS.Submission.name,
  ContractMethodNames.submitSignatures
);
export const relaySignature = encodingUtils.getFunctionSignature(CONTRACTS.Relay.name, ContractMethodNames.relay);

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
  rewardEpochId: number,
  feeds: Feed[],
  amount: bigint,
  startBlock: number,
  startTime: number,
  maxBlocks: number = 100
): IndexerPosition<TLPEvents> {
  const events: TLPEvents[] = [];
  const maxBlock = startBlock + maxBlocks;
  let block = startBlock;
  let timestamp = startTime;
  for (const [i, feed] of feeds.entries()) {
    const event = generateEvent(
      CONTRACTS.FtsoRewardOffersManager,
      "RewardsOffered",
      {
        rewardEpochId,
        feedId: feed.id,
        decimals: feed.decimals,
        amount,
        minRewardedTurnoutBIPS: 100,
        primaryBandRewardSharePPM: 10000,
        secondaryBandWidthPPM: 10000,
        claimBackAddress: BURN_ADDRESS,
      },
      block,
      timestamp
    );
    events.push(event);
    if (block < maxBlock) {
      block++;
      timestamp++;
    }
  }
  const result: IndexerPosition<TLPEvents> = {
    block: startBlock + feeds.length,
    timestamp: startTime + feeds.length,
    data: events,
  };
  return result;
}

export interface VotersInVotingEpoch {
  votingRoundIds: number[];
  voterIndices: number[];
}

export interface AddressInVotingEpoch {
  votingRoundIds: number[];
  // Voter acting on behalf of the address in simulation
  voterIndex: number;
  address: string;
}

export interface RewardDataSimulationScenario {
  noSignatureSubmitters: VotersInVotingEpoch[];
  noGracePeriodFinalizers: VotersInVotingEpoch[];
  outsideGracePeriodFinalizers: VotersInVotingEpoch[];
  doubleSigners: VotersInVotingEpoch[];
  revealOffenders: VotersInVotingEpoch[];
  independentFinalizersOutsideGracePeriod: AddressInVotingEpoch[];
  useFixedCalculationResult?: boolean;
}

export const happyRewardDataSimulationScenario: RewardDataSimulationScenario = {
  noSignatureSubmitters: [],
  noGracePeriodFinalizers: [],
  outsideGracePeriodFinalizers: [],
  doubleSigners: [],
  revealOffenders: [],
  independentFinalizersOutsideGracePeriod: [],
};

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
  clock: FakeTimers.InstalledClock,
  entityManager: EntityManager,
  fspSettings: FSPSettings,
  feeds: Feed[],
  offerAmount: bigint,
  rewardEpochId: number,
  voters: TestVoter[],
  valueFunction: (votingRoundId: number, voterIndex: number, feedSequence: Feed[]) => number[],
  scenario: RewardDataSimulationScenario,
  logger: ILogger = emptyLogger
) {
  const previousRewardEpochId = rewardEpochId - 1;
  const previousRewardEpochStartSec = EPOCH_SETTINGS().expectedRewardEpochStartTimeSec(rewardEpochId - 1);
  const rewardEpochStartSec = EPOCH_SETTINGS().expectedRewardEpochStartTimeSec(rewardEpochId);
  const randomAcquisitionStartSec = rewardEpochStartSec - fspSettings.newSigningPolicyInitializationStartSeconds;
  let entities: (TLPEvents | TLPTransaction)[] = [];
  let block = 0;
  let timestamp = previousRewardEpochStartSec - 20;
  clock.setSystemTime(timestamp * 1000);

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
    const tx = generateTx(BURN_ADDRESS, BURN_ADDRESS, sigReveal, block, timestamp, sigReveal);
    mineBlock();
    await entityManager.save([tx]);
    await updateUpperState();
  }

  function generateSigningPolicy(voters: TestVoter[], rewardEpochId: number) {
    const weightSum = voters.reduce((sum, v) => sum + Number(v.registrationWeight), 0);
    const newWeightsNormalized = voters.map(v =>
      Math.floor((Number(v.registrationWeight) / weightSum) * (2 ** 16 - 1))
    );
    const newWeightSum = newWeightsNormalized.reduce((sum, w) => sum + w, 0);
    const threshold = Math.floor((fspSettings.signingPolicyThresholdPPM * newWeightSum) / 1000000);
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

  ///////////////////// ACTION PREDICATES /////////////////////////

  // true means no submission
  let noVoterSubmissionMap: Map<string, boolean>;
  function voterRoundKey(voterIndex: number, votingEpochId: number): string {
    return `${voterIndex}-${votingEpochId}`;
  }

  function shouldVoterSubmitSignature(voterIndex: number, votingEpochId: number): boolean {
    if (!noVoterSubmissionMap) {
      noVoterSubmissionMap = new Map<string, boolean>();
      for (const entry of scenario.noSignatureSubmitters) {
        for (const votingRoundId of entry.votingRoundIds) {
          for (const voterIndex of entry.voterIndices) {
            noVoterSubmissionMap.set(voterRoundKey(voterIndex, votingRoundId), true);
          }
        }
      }
    }
    return !noVoterSubmissionMap.get(voterRoundKey(voterIndex, votingEpochId));
  }

  let noVoterFinalizingGPMap: Map<string, boolean>;
  function shouldVoterFinalizeInGracePeriodIfSelected(voterIndex: number, votingEpochId: number): boolean {
    if (!noVoterFinalizingGPMap) {
      noVoterFinalizingGPMap = new Map<string, boolean>();
      for (const entry of scenario.noGracePeriodFinalizers) {
        for (const votingRoundId of entry.votingRoundIds) {
          for (const voterIndex of entry.voterIndices) {
            noVoterFinalizingGPMap.set(voterRoundKey(voterIndex, votingRoundId), true);
          }
        }
      }
    }
    return !noVoterFinalizingGPMap.get(voterRoundKey(voterIndex, votingEpochId));
  }

  let outsideGPFinalizerVoters: Map<string, boolean>;
  function shouldVoterFinalizeOutsideGracePeriod(voterIndex: number, votingEpochId: number): boolean {
    if (!outsideGPFinalizerVoters) {
      outsideGPFinalizerVoters = new Map<string, boolean>();
      for (const entry of scenario.outsideGracePeriodFinalizers) {
        for (const votingRoundId of entry.votingRoundIds) {
          for (const voterIndex of entry.voterIndices) {
            outsideGPFinalizerVoters.set(voterRoundKey(voterIndex, votingRoundId), true);
          }
        }
      }
    }
    return !!outsideGPFinalizerVoters.get(voterRoundKey(voterIndex, votingEpochId));
  }

  let revealOffendersMap: Map<string, boolean>;
  function isVoterRevealOffender(voterIndex: number, votingEpochId: number) {
    if (!revealOffendersMap) {
      revealOffendersMap = new Map<string, boolean>();
      for (const entry of scenario.revealOffenders) {
        for (const votingRoundId of entry.votingRoundIds) {
          for (const voterIndex of entry.voterIndices) {
            revealOffendersMap.set(voterRoundKey(voterIndex, votingRoundId), true);
          }
        }
      }
    }
    return !!revealOffendersMap.get(voterRoundKey(voterIndex, votingEpochId));
  }

  let doubleSignerMap: Map<string, boolean>;
  function isVoterDoubleSigner(voterIndex: number, votingEpochId: number) {
    if (!doubleSignerMap) {
      doubleSignerMap = new Map<string, boolean>();
      for (const entry of scenario.doubleSigners) {
        for (const votingRoundId of entry.votingRoundIds) {
          for (const voterIndex of entry.voterIndices) {
            doubleSignerMap.set(voterRoundKey(voterIndex, votingRoundId), true);
          }
        }
      }
    }
    return !!doubleSignerMap.get(voterRoundKey(voterIndex, votingEpochId));
  }

  let independentFinalizersOutsideGPMap: Map<number, string[]>;
  function getIndependentFinalizersOutsideGracePeriod(votingEpochId: number) {
    if (!independentFinalizersOutsideGPMap) {
      independentFinalizersOutsideGPMap = new Map<number, string[]>();
      for (const entry of scenario.independentFinalizersOutsideGracePeriod) {
        for (const votingRoundId of entry.votingRoundIds) {
          const value = independentFinalizersOutsideGPMap.get(votingRoundId) || [];
          value.push(entry.address);
          independentFinalizersOutsideGPMap.set(votingRoundId, value);
        }
      }
    }
    return independentFinalizersOutsideGPMap.get(votingEpochId) || [];
  }

  ////////// START OF DATABASE GENERATION //////////

  // mine few fake transactions before the start of the previous reward epoch
  await mineFakeTransaction();
  // put it even lower, so we have enough history
  const rewardEpochDurationSec =
    EPOCH_SETTINGS().votingEpochDurationSeconds * EPOCH_SETTINGS().rewardEpochDurationInVotingEpochs;
  // set state to ensure sufficient indexer history
  const lowerState = generateState(
    FIRST_DATABASE_INDEX_STATE,
    0,
    block - rewardEpochDurationSec,
    timestamp - rewardEpochDurationSec
  );
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
  );

  await mineFakeTransaction();

  // Emit RewardEpochStarted for previous reward epoch
  moveTo(previousRewardEpochStartSec);
  entities.push(
    generateEvent(
      CONTRACTS.FlareSystemsManager,
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
  const votePowerBlock = block; // some choice of vote power block
  await mineFakeTransaction();
  await mineFakeTransaction();

  moveTo(randomAcquisitionStartSec);

  // Emit RandomAcquisitionStarted
  entities.push(
    generateEvent(
      CONTRACTS.FlareSystemsManager,
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
      CONTRACTS.FlareSystemsManager,
      VotePowerBlockSelected.eventName,
      new VotePowerBlockSelected({
        rewardEpochId: rewardEpochId,
        votePowerBlock,
        timestamp,
      }),
      block,
      timestamp
    )
  );

  // Emulate Voter registration
  for (const voter of voters) {
    entities.push(
      generateEvent(
        CONTRACTS.FlareSystemsCalculator,
        VoterRegistrationInfo.eventName,
        new VoterRegistrationInfo({
          rewardEpochId,
          voter: voter.identityAddress,
          delegationAddress: voter.delegationAddress,
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
          publicKeyPart1: ZERO_BYTES32,
          publicKeyPart2: ZERO_BYTES32,
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
      CONTRACTS.FlareSystemsManager,
      RewardEpochStarted.eventName,
      new RewardEpochStarted({
        rewardEpochId: rewardEpochId,
        startVotingRoundId: EPOCH_SETTINGS().expectedFirstVotingRoundForRewardEpoch(rewardEpochId),
        timestamp: timestamp,
      }),
      block,
      timestamp
    )
  );
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
      throw new Error(
        `moveToVotingRoundOffset::Timestamp is too high. Current: ${timestamp}, desired: ${newTimestamp}`
      );
    }
    moveTo(newTimestamp);
  }

  const voterSelector = new RandomVoterSelector(
    signingPolicy.voters,
    signingPolicy.weights.map(n => BigInt(n)),
    FINALIZATION_VOTER_SELECTION_THRESHOLD_WEIGHT_BIPS()
  );

  const voterIndexToMiniFTSOCalculator = new Map<number, MiniFtsoCalculator>();
  const voterIndexToMiniFinalizer = new Map<number, MiniFinalizer>();
  for (let voterIndex = 0; voterIndex < voters.length; voterIndex++) {
    const voter = voters[voterIndex];
    const calculator = new MiniFtsoCalculator(voterIndex, voter.signingPrivateKey, entityManager, logger);
    voterIndexToMiniFTSOCalculator.set(voterIndex, calculator);
    const finalizer = new MiniFinalizer(voter, voterIndex, voterSelector, entityManager, logger);
    voterIndexToMiniFinalizer.set(voterIndex, finalizer);
  }
  logger.log(`STARTING WITH: ${signingPolicy.startVotingRoundId}`);
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
    const finalizationStartOffset =
      EPOCH_SETTINGS().revealDeadlineSeconds + 1 + GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC();
    const finalizationStartDeadline = EPOCH_SETTINGS().votingEpochStartSec(votingEpochId) + finalizationStartOffset;
    const finalizationEndGracePeriodOffset =
      EPOCH_SETTINGS().revealDeadlineSeconds + GRACE_PERIOD_FOR_FINALIZATION_DURATION_SEC() + 1;
    const lastFinalizationTimeOutsideGracePeriod = EPOCH_SETTINGS().votingEpochEndSec(votingEpochId) - 1;

    // REVEALS
    if (votingEpochId > signingPolicy.startVotingRoundId) {
      logger.log(`REVEALS ${votingEpochId - 1}`);
      const lastRevealTime =
        EPOCH_SETTINGS().votingEpochStartSec(votingEpochId) + EPOCH_SETTINGS().revealDeadlineSeconds - 2;
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
        if (isVoterRevealOffender(voterIndex, votingEpochId - 1)) {
          continue;
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
      logger.log(`SIGNATURES ${votingEpochId - 1}`);
      moveToVotingEpochOffset(votingEpochId, signatureStartOffset + 1);
      let fixedCalculationResult: EpochResult | undefined;
      for (let voterIndex = 0; voterIndex < voters.length; voterIndex++) {
        if (!shouldVoterSubmitSignature(voterIndex, votingEpochId - 1)) {
          continue;
        }
        const voter = voters[voterIndex];
        const calculator = voterIndexToMiniFTSOCalculator.get(voterIndex);
        if (scenario.useFixedCalculationResult && !fixedCalculationResult) {
          fixedCalculationResult = await calculator.prepareCalculationResultData(votingEpochId - 1);
        }
        const payload = await calculator.getSignaturePayload(votingEpochId - 1, false, fixedCalculationResult);
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
        if (isVoterDoubleSigner(voterIndex, votingEpochId - 1)) {
          const payload = await calculator.getSignaturePayload(votingEpochId - 1, true, fixedCalculationResult);
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
        }
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
      logger.log(`FINALIZATIONS ${votingEpochId - 1}`);
      const lastFinalizationTime = EPOCH_SETTINGS().votingEpochEndSec(votingEpochId);
      if (timestamp >= lastFinalizationTime) {
        throw new Error("Last finalization timestamp is too high");
      }

      moveToVotingEpochOffset(votingEpochId, finalizationStartOffset);

      // Finalization in grace period
      for (let voterIndex = 0; voterIndex < voters.length; voterIndex++) {
        if (!shouldVoterFinalizeInGracePeriodIfSelected(voterIndex, votingEpochId - 1)) {
          continue;
        }
        const finalizer = voterIndexToMiniFinalizer.get(voterIndex);

        const selectionIndex = voterSelector.inSelectionList(
          signingPolicy.voters.map(x => x.toLowerCase()),
          signingPolicy.seed,
          FTSO2_PROTOCOL_ID,
          votingEpochId - 1,
          finalizer.voter.signingAddress
        );
        if (selectionIndex < 0) {
          continue;
        }
        const tx = await finalizer.processFinalization(votingEpochId - 1, block, timestamp);
        if (tx) {
          entities.push(tx);
        }
        if (timestamp < lastFinalizationTime) {
          mineBlock();
        }
      }

      // Finalizations outside grace period
      moveToVotingEpochOffset(votingEpochId, finalizationEndGracePeriodOffset);
      for (let voterIndex = 0; voterIndex < voters.length; voterIndex++) {
        if (!shouldVoterFinalizeOutsideGracePeriod(voterIndex, votingEpochId - 1)) {
          continue;
        }
        const finalizer = voterIndexToMiniFinalizer.get(voterIndex);

        const selectionIndex = voterSelector.inSelectionList(
          signingPolicy.voters.map(x => x.toLowerCase()),
          signingPolicy.seed,
          FTSO2_PROTOCOL_ID,
          votingEpochId - 1,
          finalizer.voter.signingAddress
        );
        if (selectionIndex < 0) {
          continue;
        }
        const tx = await finalizer.processFinalization(votingEpochId - 1, block, timestamp);
        if (tx) {
          entities.push(tx);
        }
        if (timestamp < lastFinalizationTime) {
          mineBlock();
        }
      }

      // Finalizations by independent addresses
      const independentFinalizers = getIndependentFinalizersOutsideGracePeriod(votingEpochId - 1);
      // use the first finalizer
      const finalizer = voterIndexToMiniFinalizer.get(0);
      for (const address of independentFinalizers) {
        // override the sending address
        const tx = await finalizer.processFinalization(votingEpochId - 1, block, timestamp, address);
        if (tx) {
          entities.push(tx);
        }
        if (timestamp < lastFinalizationTimeOutsideGracePeriod) {
          mineBlock();
        }
      }

      await entityManager.save(entities);
      await updateUpperState();
      entities = [];
    }

    // COMMITS
    if (votingEpochId <= lastVotingEpochId) {
      logger.log(`COMMITS ${votingEpochId}`);
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
          values: feedValues,
          encodedValues: feedEncoded,
        };
        insertIntoRevealsMap(votingEpochId, voterIndex, voterRevealData);

        const hash = CommitData.hashForCommit(
          voter.submitAddress,
          votingEpochId,
          voterRevealData.random,
          voterRevealData.encodedValues
        );
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
}
