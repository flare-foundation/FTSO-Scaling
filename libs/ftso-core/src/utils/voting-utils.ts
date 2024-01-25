import BN from "bn.js";
import utils from "web3-utils";


/**
 * Converts a given number to BN.
 */
export function toBN(x: BN | number | string): BN {
  if (x instanceof BN) return x;
  return utils.toBN(x);
}


// /**
//  * Hashing {@link RewardClaim} struct.
//  */
// export function hashRewardClaim(data: RewardClaim): string {
//   const rewardClaimAbi: any = EncodingUtils.instance.abiInputForName("rewardClaimDefinition")!;
//   return utils.soliditySha3(defaultAbiCoder.encode([rewardClaimAbi], [hexlifyBN(data)]))!;
// }

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

export function hashBytes(hexString: string): string {
  if (hexString.length === 0) throw new Error("Cannot hash empty string");

  let toHash = hexString;
  if (!hexString.startsWith("0x")) toHash = "0x" + hexString;
  return utils.soliditySha3({ type: "bytes", value: toHash })!;
}
