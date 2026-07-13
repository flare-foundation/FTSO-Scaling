import { Feed } from "../voting-types";
import { unPrefix0x } from "../utils/encoding";
import { FeedValueEncoder, ValueWithDecimals } from "./FeedValueEncoder";
import { IPayloadMessage } from "../fsp-utils/PayloadMessage";

export interface IRevealData {
  readonly random: string;
  readonly feeds: Feed[];
  readonly values?: number[];
  readonly valuesWithDecimals?: ValueWithDecimals[];
  readonly encodedValues: string;
}

export namespace RevealData {
  export function encode(revealData: IRevealData): string {
    if (!/^0x[0-9a-f]{64}$/i.test(revealData.random)) {
      throw Error(`Invalid random format: ${revealData.random}`);
    }
    return revealData.random + unPrefix0x(revealData.encodedValues);
  }

  /**
   * @param allowRandomOnlyReveal Whether a reveal carrying only the 32-byte random and no feed values is accepted
   *   (decoded as all-empty feed values). This is the current (FIP.16-era) behaviour. Before FIP.16 activation the
   *   caller passes `false` so a random-only reveal is rejected — reproducing the pre-FIP.16 (v1.0.9) behaviour, where
   *   such a reveal threw during value decoding and was skipped — so mixed-version deployments agree on the
   *   valid-reveal set, random, offender/benching state and Merkle root before the activation epoch.
   */
  export function decode(encoded: string, feeds: Feed[], allowRandomOnlyReveal = true): IRevealData {
    if (!/^0x[0-9a-f]*$/i.test(encoded) || encoded.length % 2 !== 0) {
      throw Error(`Invalid encoding format: ${encoded}`);
    }
    if (encoded.length < 66) {
      throw Error(`Invalid reveal: missing 32-byte random (length ${encoded.length})`);
    }
    if (!allowRandomOnlyReveal && encoded.length === 66) {
      throw Error("Invalid reveal: random-only reveal with no feed values (rejected before FIP.16)");
    }
    return {
      random: encoded.slice(0, 66),
      feeds,
      valuesWithDecimals: FeedValueEncoder.decode("0x" + encoded.slice(66), feeds),
      encodedValues: "0x" + encoded.slice(66),
    };
  }

  export function decodePayloadMessage(
    message: IPayloadMessage<string>,
    feeds: Feed[],
    allowRandomOnlyReveal = true
  ): IPayloadMessage<IRevealData> {
    return {
      ...message,
      payload: RevealData.decode(message.payload, feeds, allowRandomOnlyReveal),
    };
  }
}
