/* eslint-disable */
import { RawEventConstructible } from "./RawEventConstructible";
import { decodeEvent } from "../abi/AbiCache";

/**
 * Represents the `AttestationRequested` event emitted on submission of an FDC2 attestation request on the
 * Fdc2Hub smart contract.
 *
 * NOT to be confused with {@link AttestationRequest}, the legacy `FdcHub.AttestationRequest` event. They are
 * different contracts, different events and different reward paths; only the names look alike. This class is named
 * `Fdc2AttestationRequested` rather than `AttestationRequested` to keep the two impossible to mix up at call sites.
 *
 * The `fee` is the configured attestation type/source fee and is credited to `RewardManager` in the same call.
 * The remainder of the payment (`msg.value - fee`) is forwarded into FlareTeeManager and shows up as the `fee` of
 * a {@link TeeInstructionsSent} event carrying the same `instructionId`, so the two events are disjoint and
 * together account for the whole payment.
 */
export class Fdc2AttestationRequested extends RawEventConstructible {
  static eventName = "AttestationRequested";
  // Resolved as a literal rather than through CONTRACTS, because CONTRACTS.Fdc2Hub is undefined on networks
  // where the FCC contracts are not deployed.
  static contractName = "Fdc2Hub" as const;

  constructor(data: any, timestamp: number) {
    super();
    if (timestamp === undefined) {
      throw new Error("Timestamp is required");
    }
    this.instructionId = data.instructionId;
    this.attestationType = data.attestationType;
    this.sourceId = data.sourceId;
    this.proofOwner = data.proofOwner;
    this.claimBackAddress = data.claimBackAddress;
    this.fee = BigInt(data.fee);
    this.timestamp = timestamp;
  }

  static fromRawEvent(event: any): Fdc2AttestationRequested {
    return decodeEvent<Fdc2AttestationRequested>(
      Fdc2AttestationRequested.contractName,
      Fdc2AttestationRequested.eventName,
      event,
      (data: any, entity: any) => new Fdc2AttestationRequested(data, entity.timestamp)
    );
  }

  // instruction id shared with the paired TeeInstructionsSent event emitted in the same transaction
  instructionId: string;

  // attestation type and source of the request
  attestationType: string;
  sourceId: string;

  // address that owns the resulting proof
  proofOwner: string;

  // address allowed to claim the fee back if the request is not served; carried for future rewarding logic
  claimBackAddress: string;

  // fee in wei, credited to RewardManager
  fee: bigint;

  // timestamp
  timestamp: number;
}
