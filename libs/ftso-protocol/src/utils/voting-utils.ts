import { defaultAbiCoder } from "@ethersproject/abi";
import BN from "bn.js";
import coder from "web3-eth-abi";
import utils from "web3-utils";
import { Feed, RewardClaim } from "../voting-types";
import EncodingUtils, { bytes4ToText } from "./EncodingUtils";
import { Bytes32 } from "./sol-types";

export const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Converts a given number to BN.
 */
export function toBN(x: BN | number | string): BN {
  if (x instanceof BN) return x;
  return utils.toBN(x);
}

/**
 * A sorted hash of two 32-byte strings
 * @param x first `0x`-prefixed 32-byte hex string
 * @param y second `0x`-prefixed 32-byte hex string
 * @returns the sorted hash
 */
export function sortedHashPair(x: string, y: string) {
  if (x <= y) {
    return utils.soliditySha3(coder.encodeParameters(["bytes32", "bytes32"], [x, y]));
  }
  return utils.soliditySha3(coder.encodeParameters(["bytes32", "bytes32"], [y, x]));
}

/**
 * Hashing {@link RewardClaim} struct.
 */
export function hashRewardClaim(data: RewardClaim): string {
  const rewardClaimAbi: any = EncodingUtils.instance.abiInputForName("rewardClaimDefinition")!;
  return utils.soliditySha3(defaultAbiCoder.encode([rewardClaimAbi], [hexlifyBN(data)]))!;
}

/**
 * Converts text representation of a symbol to bytes4.
 */
export function toBytes4(text: string): string {
  if (!text || text.length === 0) {
    throw new Error(`Text should be non-null and non-empty`);
  }
  if (/^0x[0-9a-f]{8}$/i.test(text)) {
    return text; // no conversion needed
  }
  if (text.length > 4) {
    throw new Error(`Text should be at most 4 characters long`);
  }
  return utils.padRight(utils.asciiToHex(text), 8);
}

/**
 * Converts feed symbols withing the Feed from text to bytes.
 */
export function feedToBytes4(feed: Feed): Feed {
  return {
    offerSymbol: toBytes4(feed.offerSymbol),
    quoteSymbol: toBytes4(feed.quoteSymbol),
  } as Feed;
}

export function unprefixedSymbolBytes(feed: Feed) {
  return `${toBytes4(feed.offerSymbol).slice(2)}${toBytes4(feed.quoteSymbol).slice(2)}`;
}

/**
 * Converts feed symbols withing the Feed from bytes to text.
 */
export function feedToText(feed: Feed): Feed {
  return {
    ...feed,
    offerSymbol: bytes4ToText(feed.offerSymbol),
    quoteSymbol: bytes4ToText(feed.quoteSymbol),
  } as Feed;
}

/**
 * Id of a feed is a string of the form `offerSymbol-quoteSymbol`.
 */
export function feedId(feed: Feed) {
  return `${feed.offerSymbol}-${feed.quoteSymbol}`;
}

/**
 * Prefixes hex string with `0x` if the string is not yet prefixed.
 * It can handle also negative values.
 * @param tx input hex string with or without `0x` prefix
 * @returns `0x` prefixed hex string.
 */
export function prefix0xSigned(tx: string) {
  if (tx.startsWith("0x") || tx.startsWith("-0x")) {
    return tx;
  }
  if (tx.startsWith("-")) {
    return "-0x" + tx.slice(1);
  }
  return "0x" + tx;
}

/**
 * Converts objects to Hex value (optionally left padded)
 * @param x input object
 * @param padToBytes places to (left) pad to (optional)
 * @returns (padded) hex valu
 */
export function toHex(x: string | number | BN, padToBytes?: number) {
  if ((padToBytes as any) > 0) {
    return utils.leftPad(utils.toHex(x), padToBytes! * 2);
  }
  return utils.toHex(x);
}

/**
 * Converts fields of an object to Hex values
 * Note: negative values are hexlified with '-0x'.
 * This is compatible with web3.eth.encodeParameters
 * @param obj input object
 * @returns object with matching fields to input object but instead having various number types (number, BN)
 * converted to hex values ('0x'-prefixed).
 */
export function hexlifyBN(obj: any): any {
  const isHexReqex = /^[0-9A-Fa-f]+$/;
  if (BN.isBN(obj)) {
    return prefix0xSigned(toHex(obj));
  }
  if (Array.isArray(obj)) {
    return (obj as any[]).map(item => hexlifyBN(item));
  }
  if (typeof obj === "object") {
    const res = {} as any;
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      res[key] = hexlifyBN(value);
    }
    return res;
  }
  if (typeof obj === "string" && obj.match(isHexReqex)) {
    return prefix0xSigned(obj);
  }
  return obj;
}

export function packPrices(prices: (number | string)[]) {
  return (
    "0x" +
    prices
      .map(price =>
        parseInt("" + price)
          .toString(16)
          .padStart(8, "0")
      )
      .join("")
  );
}

export function parsePrices(packedPrices: string, numberOfFeeds: number) {
  let feedPrice =
    packedPrices
      .slice(2)
      .match(/(.{1,8})/g)
      ?.map(hex => toBN(hex)) || [];
  feedPrice = feedPrice.slice(0, numberOfFeeds);
  feedPrice = padEndArray(feedPrice, numberOfFeeds, 0);
  return feedPrice;
}

function padEndArray(array: any[], minLength: number, fillValue: any = undefined) {
  return Object.assign(new Array(minLength).fill(fillValue), array);
}

export function hashForCommit(voter: string, random: string, merkleRoot: string, prices: string) {
  const types = ["address", "uint256", "bytes32", "bytes"];
  const values = [voter.toLowerCase(), random, merkleRoot, prices];
  const encoded = coder.encodeParameters(types, values);
  return utils.soliditySha3(encoded)!;
}

/** We XOR the random values provided by each voter to obtain a single combined random value for the price epoch. */
export function combineRandom(randoms: Bytes32[]): Bytes32 {
  return randoms.reduce((a, b) => a.xor(b), Bytes32.ZERO);
}

export function hashBytes(hexString: string): string {
  if (hexString.length === 0) throw new Error("Cannot hash empty string");

  let toHash = hexString;
  if (!hexString.startsWith("0x")) toHash = "0x" + hexString;
  return utils.soliditySha3({ type: "bytes", value: toHash })!;
}
