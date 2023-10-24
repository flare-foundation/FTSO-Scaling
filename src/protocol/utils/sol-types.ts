import Web3 from "web3";

export class Bytes32 {
  private constructor(private readonly bytes: number[], private hex: string | undefined = undefined) {}

  static fromHexString(input: string): Bytes32 {
    let bytes: number[];
    try {
      bytes = Web3.utils.hexToBytes(input);
    } catch (e) {
      throw new Error(`Input must be a hex string: ${e}`);
    }
    if (bytes.length != 32) throw new Error("Input must be 32 bytes long.");
    return new Bytes32(bytes, input);
  }

  /** Returns the hexadecimal representation of the value, prefixed with "0x". */
  get value(): string {
    if (this.hex === undefined) this.hex = Web3.utils.bytesToHex(this.bytes);
    return this.hex;
  }

  toString(): string {
    return this.value;
  }

  xor(other: Bytes32): Bytes32 {
    const a = this.bytes;
    const b = other.bytes;
    const result = new Array<number>(32);
    for (let i = 0; i < 32; i++) {
      result[i] = a[i] ^ b[i];
    }
    return new Bytes32(result);
  }

  equals(other: Bytes32): boolean {
    return this.value === other.value;
  }

  static random(): Bytes32 {
    return this.fromHexString(Web3.utils.randomHex(32));
  }

  static ZERO: Bytes32 = new Bytes32(new Array<number>(32).fill(0));
}
