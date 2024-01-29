
////////////////////////////////////////////////////////////////////////////////////////////////////////
// This file is copied from the Flare Smart Contract V2 repository.
// DO NOT CHANGE!
// See: https://gitlab.com/flarenetwork/flare-smart-contracts-v2/-/tree/main/scripts/libs/protocol
////////////////////////////////////////////////////////////////////////////////////////////////////////


import Web3 from "web3";
import { ECDSASignature, IECDSASignature } from "./ECDSASignature";
import { IPayloadMessage, PayloadMessage } from "./PayloadMessage";
import { IProtocolMessageMerkleRoot, ProtocolMessageMerkleRoot } from "./ProtocolMessageMerkleRoot";
import { ISigningPolicy } from "./SigningPolicy";
import { ECDSASignatureWithIndex, IECDSASignatureWithIndex } from "./ECDSASignatureWithIndex";

const web3 = new Web3("https://dummy");
export interface ISignaturePayload {
  type: string;
  message: IProtocolMessageMerkleRoot;
  signature: IECDSASignature;
  unsignedMessage: string;
  signer?: string;
  index?: number;
  messageHash?: string;
  weight?: number;
}

export interface DepositSignatureData {
  message: string;
  additionalData: string;
}

export namespace SignaturePayload {
  /**
   * Endodes signature payload into byte encoding, represented by 0x-prefixed hex string
   * @param signaturePayload
   * @returns
   */
  export function encode(signaturePayload: ISignaturePayload): string {
    const message = ProtocolMessageMerkleRoot.encode(signaturePayload.message);
    const signature = ECDSASignature.encode(signaturePayload.signature);
    if (!/^0x[0-9a-f]{2}$/.test(signaturePayload.type)) {
      throw Error(`Invalid type format: ${signaturePayload.type}`);
    }
    if (signaturePayload.unsignedMessage && (!/^0x[0-9a-f]*$/.test(signaturePayload.unsignedMessage) || signaturePayload.unsignedMessage.length % 2 !== 0)) {
      throw Error(`Invalid unsigned message format: ${signaturePayload.unsignedMessage}`);
    }

    return (
      "0x" +
      signaturePayload.type.slice(2) +
      message.slice(2) +
      signature.slice(2) +
      (signaturePayload.unsignedMessage ?? "").slice(2)
    ).toLowerCase();
  }

  /**
   * Decodes signature payload from byte encoding, represented by 0x-prefixed hex string
   * @param encodedSignaturePayload
   * @returns
   */
  export function decode(encodedSignaturePayload: string): ISignaturePayload {
    const encodedSignaturePayloadInternal = encodedSignaturePayload.startsWith("0x")
      ? encodedSignaturePayload.slice(2)
      : encodedSignaturePayload;
    if (!/^[0-9a-f]*$/.test(encodedSignaturePayloadInternal)) {
      throw Error(`Invalid format - not hex string: ${encodedSignaturePayload}`);
    }
    if (encodedSignaturePayloadInternal.length < 2 + 38 * 2 + 65 * 2) {
      throw Error(`Invalid format - too short: ${encodedSignaturePayload}`);
    }
    const type = "0x" + encodedSignaturePayloadInternal.slice(0, 2);
    const message = "0x" + encodedSignaturePayloadInternal.slice(2, 2 + 38 * 2);
    const signature = "0x" + encodedSignaturePayloadInternal.slice(2 + 38 * 2, 2 + 38 * 2 + 65 * 2);
    const unsignedMessage = "0x" + encodedSignaturePayloadInternal.slice(2 + 38 * 2 + 65 * 2);
    return {
      type,
      message: ProtocolMessageMerkleRoot.decode(message),
      signature: ECDSASignature.decode(signature),
      unsignedMessage,
    };
  }

  /**
   * Decodes properly formatted signature calldata into array of payloads with signatures
   * @param calldata
   */
  export function decodeCalldata(calldata: string): IPayloadMessage<ISignaturePayload>[] {
    const calldataInternal = calldata.startsWith("0x") ? calldata.slice(2) : calldata;
    if (!(/^[0-9a-f]*$/.test(calldataInternal) && calldataInternal.length % 2 === 0)) {
      throw Error(`Invalid format - not byte sequence representing hex string: ${calldata}`);
    }
    if (calldataInternal.length < 8) {
      throw Error(`Invalid format - too short: ${calldata}`);
    }
    const strippedCalldata = "0x" + calldataInternal.slice(8);
    const signatureRecords = PayloadMessage.decode(strippedCalldata);
    const result: IPayloadMessage<ISignaturePayload>[] = [];
    for (let record of signatureRecords) {
      result.push({
        protocolId: record.protocolId,
        votingRoundId: record.votingRoundId,
        payload: SignaturePayload.decode(record.payload),
      });
    }
    return result;
  }

  /**
   * Verifies signatures against message hash and signing policy.
   * The signatures have to be from signing policy and sorted according to signing policy.
   * @param signaturePayloads
   * @param signingPolicy
   * @returns
   */
  export function verifySignatures(
    messageHash: string,
    signatures: IECDSASignature[],
    signingPolicy: ISigningPolicy
  ): boolean {
    if (signatures.length === 0) {
      return false;
    }
    const weightMap: Map<string, number> = new Map<string, number>();
    const signerIndex: Map<string, number> = new Map<string, number>();
    for (let i = 0; i < signingPolicy.voters.length; i++) {
      weightMap.set(signingPolicy.voters[i].toLowerCase(), signingPolicy.weights[i]);
      signerIndex.set(signingPolicy.voters[i].toLowerCase(), i);
    }
    let totalWeight = 0;
    let nextAllowedSignerIndex = 0;
    for (let signature of signatures) {
      const signer = web3.eth.accounts.recover(
        messageHash,
        "0x" + signature.v.toString(16),
        signature.r,
        signature.s
      ).toLowerCase();
      const index = signerIndex.get(signer);
      if (index === undefined) {
        throw Error(`Invalid signer: ${signer}. Not in signing policy`);
      }
      if (index < nextAllowedSignerIndex) {
        throw Error(`Invalid signer sequence.`);
      }
      nextAllowedSignerIndex = index + 1;
      const weight = weightMap.get(signer);
      if (weight === undefined) { // This should not happen
        throw Error(`Invalid signer: ${signer}. Not in signing policy`);
      }
      totalWeight += weight;
      if (totalWeight > signingPolicy.threshold) {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks whether signature payloads satisfy signing policy threshold.
   * It is assumed that signature payloads have the same message and
   * are sorted according to signing policy.
   * @param signaturePayloads
   * @param signingPolicy
   * @returns
   */
  export function verifySignaturePayloads(
    signaturePayloads: IPayloadMessage<ISignaturePayload>[],
    signingPolicy: ISigningPolicy
  ): boolean {
    if (signaturePayloads.length === 0) {
      return false;
    }
    const message: IProtocolMessageMerkleRoot = signaturePayloads[0].payload.message;
    const messageHash = web3.utils.keccak256(ProtocolMessageMerkleRoot.encode(message));
    const signatures: IECDSASignature[] = [];
    for (let payload of signaturePayloads) {
      if (!ProtocolMessageMerkleRoot.equals(payload.payload.message, message)) {
        throw Error(`Invalid payload message`);
      }
      signatures.push(payload.payload.signature);
    }
    return verifySignatures(messageHash, signatures, signingPolicy);
  }

  /**
   * Augments signature payload with signer and index from signerIndices map.
   * Also adds message hash.
   * @param signaturePayload 
   * @param signerIndices 
   * @returns 
   */
  export function augment(
    signaturePayload: ISignaturePayload,
    signerIndices: Map<string, number>
  ) {    
    const messageHash = web3.utils.keccak256(ProtocolMessageMerkleRoot.encode(signaturePayload.message));
    const signer = web3.eth.accounts.recover(
      messageHash,
      "0x" + signaturePayload.signature.v.toString(16),
      signaturePayload.signature.r,
      signaturePayload.signature.s
    ).toLowerCase();
    const index = signerIndices.get(signer);
    return {
      ...signaturePayload,
      signer,
      index,
      messageHash
    }
  }

  /**
   * Inserts signature payload into sorted list of signature payloads.
   * The order is by signer index. If signer index is not defined or 
   * already exists in the list, the payload is not inserted.
   * @param signaturePayloads 
   * @param entry 
   * @returns 
   */
  export function insertInSigningPolicySortedList(
    signaturePayloads: ISignaturePayload[],
    entry: ISignaturePayload
  ): boolean {
    // Nothing to do
    if (entry.signer === undefined || entry.index === undefined || entry.messageHash === undefined) {
      return false;
    }
    // First entry, fixes messageHash
    if (signaturePayloads.length === 0) {
      signaturePayloads.push(entry);
      return true;
    }
    // Each entry must match the messageHash
    if (signaturePayloads[0].messageHash !== entry.messageHash) {
      return false;
    }
    // Calculate insertion position according to index using binary search
    let left = 0;
    let right = signaturePayloads.length - 1;
    let middle = 0;
    while (left <= right) {
      middle = Math.floor((left + right) / 2);
      if (signaturePayloads[middle].index === entry.index) {
        return false;
      }
      if (signaturePayloads[middle].index! < entry.index) {
        left = middle + 1;
      } else {
        right = middle - 1;
      }
    }
    signaturePayloads.splice(left, 0, entry);
    return true;
  }

  /**
   * Encodes signature payloads into 0x-prefixed hex string representing byte encoding
   * in which first 2 bytes are represent the number of signatures N while the rest is 
   * N * (1 + 32 + 32 + 2) bytes representing byte encoded signatures with index.
   * @param signaturePayloads 
   * @returns 
   */
  export function encodeForRelay(signaturePayloads: ISignaturePayload[]): string {
    let signatures = "0x" + signaturePayloads.length.toString(16).padStart(4, "0");
    let lastIndex = -1;
    for (const payload of signaturePayloads) {
      if (payload.index === undefined) {
        throw new Error(`Payload ${payload} does not have index.`)
      }
      if (payload.index <= lastIndex) {
        throw new Error(`Payloads are not strictly monotonic sorted by index.`)
      }
      const signatureWithIndex = {
        r: payload.signature.r,
        s: payload.signature.s,
        v: payload.signature.v,
        index: payload.index!
      } as IECDSASignatureWithIndex;
      signatures += ECDSASignatureWithIndex.encode(signatureWithIndex).slice(2);
      lastIndex = payload.index;
    }
    return signatures;
  }

}
