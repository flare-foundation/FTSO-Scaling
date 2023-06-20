import BN from "bn.js";
import Web3 from "web3";
import { increaseTimeTo, toBN } from "../test-utils/utils/test-helpers";
import { VotingManagerInstance } from "../typechain-truffle";
import { ClaimReward, Feed, Offer } from "./voting-interfaces";

/**
 * Moves time to the start of the next epoch.
 * If firstRewardedPriceEpoch and REWARD_EPOCH_DURATION are provided, it will move time to the start of the next reward epoch
 * @param votingManager 
 * @param firstRewardedPriceEpoch 
 * @param REWARD_EPOCH_DURATION 
 */
export async function moveToNextEpochStart(votingManager: VotingManagerInstance, firstRewardedPriceEpoch?: BN, REWARD_EPOCH_DURATION?: number) {
  let firstEpochStartSec = await votingManager.BUFFER_TIMESTAMP_OFFSET();
  let epochDurationSec = await votingManager.BUFFER_WINDOW();

  let time;
  if (firstRewardedPriceEpoch && REWARD_EPOCH_DURATION) {
    let currentRewardEpochId = await votingManager.getCurrentRewardEpochId();
    time = firstEpochStartSec.add(
      epochDurationSec.mul(
        firstRewardedPriceEpoch.add(
          toBN(REWARD_EPOCH_DURATION).mul(currentRewardEpochId.add(toBN(1)))
        )
      )
    ).toNumber()

  } else {
    let currentEpoch = await votingManager.getCurrentEpochId();
    time = firstEpochStartSec.add(
      epochDurationSec.mul(
        currentEpoch.add(
          toBN(1)
        )
      )
    ).toNumber()
  }
  await increaseTimeTo(time);
}

/**
 * A sorted hash of two 32-byte strings
 * @param x first `0x`-prefixed 32-byte hex string
 * @param y second `0x`-prefixed 32-byte hex string
 * @returns the sorted hash
 */
export function sortedHashPair(x: string, y: string) {
  if (x <= y) {
    return web3.utils.soliditySha3(web3.eth.abi.encodeParameters(["bytes32", "bytes32"], [x, y]));
  }
  return web3.utils.soliditySha3(web3.eth.abi.encodeParameters(["bytes32", "bytes32"], [y, x]));
}

// TODO: take the parameter type from the generated ABI
// web3.eth.abi.encodeParameters
export function hashClaimReward(data: ClaimReward, abi: any): string {
  // let encoded = web3.eth.abi.encodeParameter(abi, hexlifyBN(data.claimRewardBody));
  // let decoded = web3.eth.abi.decodeParameter(abi, encoded);
  // console.log("INPUT");
  // console.dir(data.claimRewardBody);
  // console.log("DECODE");
  // console.dir(decoded);
  return web3.utils.soliditySha3(web3.eth.abi.encodeParameter(abi, hexlifyBN(data.claimRewardBody)))!;
}

export function toBytes4(text: string) {
  if (!text || text.length === 0) {
    throw new Error(`Text should be non-null and non-empty`);
  }
  if (/^0x[0-9a-f]{8}$/i.test(text)) {
    return text; // no conversion needed
  }
  if (text.length > 4) {
    throw new Error(`Text should be at most 4 characters long`);
  }
  return web3.utils.padRight(web3.utils.asciiToHex(text), 8);
}

export function bytes4ToText(bytes4: string) {
  if (!bytes4 || bytes4.length === 0) {
    throw new Error(`Bytes4 should be non-null and non-empty`);
  }
  if (!/^0x[0-9a-f]{8}$/i.test(bytes4)) {
    throw new Error(`Bytes4 should be a 4-byte hex string`);
  }
  return web3.utils.hexToAscii(bytes4).replace(/\u0000/g, '');
}

export function feedToBytes4(feed: Feed): Feed {
  return {
    offerSymbol: toBytes4(feed.offerSymbol),
    quoteSymbol: toBytes4(feed.quoteSymbol),
  } as Feed;
}

export function feedToText(feed: Feed): Feed {
  return {
    ...feed,
    offerSymbol: bytes4ToText(feed.offerSymbol),
    quoteSymbol: bytes4ToText(feed.quoteSymbol),
  } as Feed;
}

/**
 * Removes annoying index fields from an object.
 * @param obj 
 * @returns 
 */
export function removeIndexFields<T>(obj: T): T {
  return Object.keys(obj as any)
    .filter((key) => !key!.match(/^[0-9]+$/))
    .reduce((result: any, key: string) => {
      return Object.assign(result, {
        [key]: (obj as any)[key]
      });
    }, {}) as T;
}

/**
 * Converts an offer from web3 response to a more usable format, matching
 * the Offer interface.
 * @param offer 
 * @returns 
 */
export function convertOfferFromWeb3Response(offer: Offer): Offer {
  let tmp = feedToText(removeIndexFields(offer)) as Offer;
  tmp.amount = toBN(tmp.amount);
  return tmp;
}

/**
 * Id of a feed is a string of the form `offerSymbol-quoteSymbol`.
 * @param feed 
 * @returns 
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
    return Web3.utils.leftPad(Web3.utils.toHex(x), padToBytes! * 2);
  }
  return Web3.utils.toHex(x);
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
    return (obj as any[]).map((item) => hexlifyBN(item));
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