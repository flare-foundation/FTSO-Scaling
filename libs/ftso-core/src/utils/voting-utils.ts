import Web3 from "web3";

const utils = Web3.utils;

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
export function toHex(x: string | number, padToBytes?: number) {
  if ((padToBytes as any) > 0) {
    return utils.leftPad(utils.toHex(x), padToBytes! * 2);
  }
  return utils.toHex(x);
}

export function hashBytes(hexString: string): string {
  if (hexString.length === 0) throw new Error("Cannot hash empty string");

  let toHash = hexString;
  if (!hexString.startsWith("0x")) toHash = "0x" + hexString;
  return utils.soliditySha3({ type: "bytes", value: toHash })!;
}
