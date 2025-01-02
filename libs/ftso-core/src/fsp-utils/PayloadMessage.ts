export interface IPayloadMessage<T> {
  protocolId: number;
  votingRoundId: number;
  payload: T;
}

export namespace PayloadMessage {
  /**
   * Encodes data in byte sequence that can be concatenated with other encoded data for use in submission functions in
   * Submission.sol contract
   */
  export function encode(payloadMessage: IPayloadMessage<string>): string {
    if (
      payloadMessage.protocolId < 0 ||
      payloadMessage.protocolId > 2 ** 8 - 1 ||
      payloadMessage.protocolId % 1 !== 0
    ) {
      throw Error(`Protocol id out of range: ${payloadMessage.protocolId}`);
    }
    if (
      payloadMessage.votingRoundId < 0 ||
      payloadMessage.votingRoundId > 2 ** 32 - 1 ||
      payloadMessage.votingRoundId % 1 !== 0
    ) {
      throw Error(`Voting round id out of range: ${payloadMessage.votingRoundId}`);
    }
    if (!/^0x[0-9a-f]*$/i.test(payloadMessage.payload)) {
      throw Error(`Invalid payload format: ${payloadMessage.payload}`);
    }
    return (
      "0x" +
      payloadMessage.protocolId.toString(16).padStart(2, "0") +
      payloadMessage.votingRoundId.toString(16).padStart(8, "0") +
      (payloadMessage.payload.slice(2).length / 2).toString(16).padStart(4, "0") +
      payloadMessage.payload.slice(2)
    ).toLowerCase();
  }

  /**
   * Decodes data from concatenated byte sequence.
   * The function handles 0x-prefixed or pure hex strings as inputs.
   */
  export function decode(message: string): IPayloadMessage<string>[] {
    const messageInternal = message.startsWith("0x") ? message.slice(2) : message;
    if (!/^[0-9a-f]*$/.test(messageInternal)) {
      throw Error(`Invalid format - not hex string: ${message}`);
    }
    if (messageInternal.length % 2 !== 0) {
      throw Error(`Invalid format - not even length: ${message.length}`);
    }
    let i = 0;
    const result: IPayloadMessage<string>[] = [];
    while (i < messageInternal.length) {
      // 14 = 2 + 8 + 4
      if (messageInternal.length - i < 14) {
        throw Error(`Invalid format - too short. Error at ${i} of ${message.length}`);
      }
      const protocolId = parseInt(messageInternal.slice(i, i + 2), 16);
      const votingRoundId = parseInt(messageInternal.slice(i + 2, i + 10), 16);
      const payloadLength = parseInt(messageInternal.slice(i + 10, i + 14), 16);
      const payload = "0x" + messageInternal.slice(i + 14, i + 14 + payloadLength * 2);
      if (payloadLength * 2 + 14 > messageInternal.length - i) {
        throw Error(`Invalid format - too short: ${message.length}`);
      }
      i += payloadLength * 2 + 14;
      result.push({
        protocolId,
        votingRoundId,
        payload,
      });
    }
    return result;
  }

  /**
   * Concatenates hex strings into one hex string.
   * In the process it checks if each string is a valid hex string.
   */
  export function concatenateHexStrings(hexStrings: string[]): string {
    let result = "0x";
    for (const hexString of hexStrings) {
      if (!/^0x([0-9a-f][0-9a-f])*$/i.test(hexString)) {
        throw Error(`Invalid hex string format: ${hexString}`);
      }
      result += hexString.slice(2);
    }
    return result;
  }
}
