import Web3 from "web3";

const utils = Web3.utils;

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

export function isValidHexString(str: string): boolean {
  return /^0x[0-9a-f]*$/i.test(str);
}

export function isValidContractAddress(address: string): boolean {
  return isValidHexString(address) && address.length === 42;
}
