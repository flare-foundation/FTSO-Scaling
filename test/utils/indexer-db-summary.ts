import { EntityManager } from "typeorm";
import { BURN_ADDRESS, CONTRACTS, EPOCH_SETTINGS, GRACE_PERIOD_FOR_SIGNATURES_DURATION_SEC } from "../../libs/ftso-core/src/configs/networks";
import { writeFileSync } from "fs";
import {
  InflationRewardsOffered,
  RandomAcquisitionStarted,
  RewardEpochStarted, RewardsOffered,
  SigningPolicyInitialized,
  VotePowerBlockSelected,
  VoterRegistered,
  VoterRegistrationInfo
} from "../../libs/ftso-core/src/events";
import { TLPEvents, TLPState, TLPTransaction } from "../../libs/ftso-core/src/orm/entities";
import { ILogger, emptyLogger } from "../../libs/ftso-core/src/utils/ILogger";
import { TestVoter } from "./basic-generators";
import { encodingUtils, sigCommit, sigReveal, sigSignature, relaySignature } from "./generators-rewards";



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
    return EPOCH_SETTINGS().rewardEpochForTimeSec(timestamp);
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
  if (eventAddress === CONTRACTS.FlareSystemsManager.address.toLowerCase()) {
    if ("0x" + event.topic0 === encodingUtils.getEventSignature(CONTRACTS.FlareSystemsManager.name, RandomAcquisitionStarted.eventName)) {
      const parsedEvent = RandomAcquisitionStarted.fromRawEvent(event);
      return `${event.timestamp};${event.block_number};${votingEpoch(event.timestamp)};${rewardEpoch(event.timestamp)};RandomAcquisitionStarted;rewardEpochId: ${parsedEvent.rewardEpochId}`;
    }
    if ("0x" + event.topic0 === encodingUtils.getEventSignature(CONTRACTS.FlareSystemsManager.name, VotePowerBlockSelected.eventName)) {
      const parsedEvent = VotePowerBlockSelected.fromRawEvent(event);
      return `${event.timestamp};${event.block_number};${votingEpoch(event.timestamp)};${rewardEpoch(event.timestamp)};VotePowerBlockSelected;rewardEpochId: ${parsedEvent.rewardEpochId}`;
    }

    if ("0x" + event.topic0 === encodingUtils.getEventSignature(CONTRACTS.FlareSystemsManager.name, RewardEpochStarted.eventName)) {
      const parsedEvent = RewardEpochStarted.fromRawEvent(event);
      return `${event.timestamp};${event.block_number};${votingEpoch(event.timestamp)};${rewardEpoch(event.timestamp)};RewardEpochStarted;rewardEpochId: ${parsedEvent.rewardEpochId}`;
    }
  }
  if (eventAddress === CONTRACTS.VoterRegistry.address.toLowerCase()) {
    if ("0x" + event.topic0 === encodingUtils.getEventSignature(CONTRACTS.VoterRegistry.name, VoterRegistered.eventName)) {
      const parsedEvent = VoterRegistered.fromRawEvent(event);
      return `${event.timestamp};${event.block_number};${votingEpoch(event.timestamp)};${rewardEpoch(event.timestamp)};VoterRegistered;rewardEpochId: ${parsedEvent.rewardEpochId};voter: ${voterToIndexMap.get(parsedEvent.voter.toLowerCase())}`;
    }
  }
  if (eventAddress === CONTRACTS.FlareSystemsCalculator.address.toLowerCase()) {
    if ("0x" + event.topic0 === encodingUtils.getEventSignature(CONTRACTS.FlareSystemsCalculator.name, VoterRegistrationInfo.eventName)) {
      const parsedEvent = VoterRegistrationInfo.fromRawEvent(event);
      return `${event.timestamp};${event.block_number};${votingEpoch(event.timestamp)};${rewardEpoch(event.timestamp)};VoterRegistrationInfo;rewardEpochId: ${parsedEvent.rewardEpochId};voter: ${voterToIndexMap.get(parsedEvent.voter.toLowerCase())}`;
    }
  }
  if (eventAddress === CONTRACTS.Relay.address.toLowerCase()) {
    if ("0x" + event.topic0 === encodingUtils.getEventSignature(CONTRACTS.Relay.name, SigningPolicyInitialized.eventName)) {
      const parsedEvent = SigningPolicyInitialized.fromRawEvent(event);
      return `${event.timestamp};${event.block_number};${votingEpoch(event.timestamp)};${rewardEpoch(event.timestamp)};SigningPolicyInitialized;rewardEpochId: ${parsedEvent.rewardEpochId}`;
    }
  }
  if (eventAddress === CONTRACTS.FtsoRewardOffersManager.address.toLowerCase()) {
    if ("0x" + event.topic0 === encodingUtils.getEventSignature(CONTRACTS.FtsoRewardOffersManager.name, RewardsOffered.eventName)) {
      const parsedEvent = RewardsOffered.fromRawEvent(event);
      return `${event.timestamp};${event.block_number};${votingEpoch(event.timestamp)};${rewardEpoch(event.timestamp)};RewardsOffered;rewardEpochId: ${parsedEvent.rewardEpochId}`;
    }
    if ("0x" + event.topic0 === encodingUtils.getEventSignature(CONTRACTS.FtsoRewardOffersManager.name, InflationRewardsOffered.eventName)) {
      const parsedEvent = InflationRewardsOffered.fromRawEvent(event);
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

export async function printSummary(entityManager: EntityManager, voters: TestVoter[], filename?: string, logger: ILogger = emptyLogger) {
  const voterToIndexMap = getVoterToIndexMap(voters);
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
  }).join("\n");

  if (filename) {
    writeFileSync(filename, text);
  } else {
    logger.log(text);
  }
}
