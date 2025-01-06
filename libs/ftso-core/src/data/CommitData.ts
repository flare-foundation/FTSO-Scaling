import { Address } from "../voting-types";
import { encodeParameters } from "web3-eth-abi";
import { soliditySha3 } from "web3-utils";
import { IPayloadMessage } from "../fsp-utils/PayloadMessage";

export interface ICommitData {
  commitHash: string;
}

export namespace CommitData {
  export function encode(commitData: ICommitData): string {
    if (!/^0x[0-9a-f]{64}$/i.test(commitData.commitHash)) {
      throw Error(`Invalid commit hash format: ${commitData.commitHash}`);
    }
    return commitData.commitHash;
  }

  export function decode(encoded: string): ICommitData {
    if (!/^0x[0-9a-f]{64}$/i.test(encoded)) {
      throw Error(`Invalid encoding format: ${encoded}`);
    }
    return {
      commitHash: encoded,
    };
  }

  export function decodePayloadMessage(message: IPayloadMessage<string>): IPayloadMessage<ICommitData> {
    return {
      ...message,
      payload: CommitData.decode(message.payload),
    };
  }

  export function hashForCommit(voter: Address, votingRoundId: number, random: string, feedValues: string): string {
    const types = ["address", "uint32", "uint256", "bytes"];
    const values = [voter.toLowerCase(), votingRoundId, random, feedValues];
    const encoded = encodeParameters(types, values);
    const hash = soliditySha3(encoded);
    if (hash === undefined) throw new Error(`Unable to compute commit hash for ${votingRoundId}`);
    return hash;
  }
}
