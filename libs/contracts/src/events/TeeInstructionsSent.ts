/* eslint-disable */
import { RawEventConstructible } from "./RawEventConstructible";
import { decodeEvent } from "../abi/AbiCache";
import { CONTRACTS } from "../constants";

/**
 * Represents an event emitted when TEE instructions are dispatched on the FlareTeeManager smart contract.
 *
 * The `fee` is the full `msg.value` of the dispatch, and it is credited to `RewardManager` for `rewardEpochId`
 * in the same call (`Instructions.sendInstructions`), so the event and the credit correspond one to one.
 *
 * `rewardEpochId` is the very value passed to `RewardManager.receiveRewards`, which makes it authoritative for
 * fund attribution: it says which epoch the funds actually landed in, independently of any voting-round bucketing.
 */
export class TeeInstructionsSent extends RawEventConstructible {
  static eventName = "TeeInstructionsSent";

  constructor(data: any, timestamp: number) {
    super();
    if (timestamp === undefined) {
      throw new Error("Timestamp is required");
    }
    this.extensionId = BigInt(data.extensionId);
    this.instructionId = data.instructionId;
    this.rewardEpochId = Number(data.rewardEpochId);
    this.opType = data.opType;
    this.opCommand = data.opCommand;
    this.claimBackAddress = data.claimBackAddress;
    this.fee = BigInt(data.fee);
    this.timestamp = timestamp;
  }

  static fromRawEvent(event: any): TeeInstructionsSent {
    return decodeEvent<TeeInstructionsSent>(
      CONTRACTS.FlareTeeManager.name,
      TeeInstructionsSent.eventName,
      event,
      (data: any, entity: any) => new TeeInstructionsSent(data, entity.timestamp)
    );
  }

  // id of the TEE extension the instructions were dispatched to (0 for the system extension)
  extensionId: bigint;

  // unique instruction id; an FDC2 request emits Fdc2AttestationRequested with this same id in the same transaction
  instructionId: string;

  // reward epoch the fee was credited to on RewardManager
  rewardEpochId: number;

  // operation type and command, kept for categorising fees once the TEE rewarding logic exists
  opType: string;
  opCommand: string;

  // address allowed to claim the fee back if the instructions are not executed; carried for future rewarding logic
  claimBackAddress: string;

  // fee in wei, the full msg.value credited to RewardManager
  fee: bigint;

  // timestamp
  timestamp: number;

  // The teeMachines, message and cosigners fields of the event are deliberately not retained: they are instruction
  // payload rather than accounting data, and would bloat the serialized reward calculation data.
}
