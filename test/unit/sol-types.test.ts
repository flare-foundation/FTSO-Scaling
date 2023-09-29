import { expect } from "chai";
import { Bytes32 } from "../../src/utils/sol-types";

describe("Bytes32", () => {
  const VALID_HEX = "0x" + "01".repeat(32);

  describe("fromHexString", () => {
    it("should throw an error if input is not a hex string", () => {
      expect(() => Bytes32.fromHexString("not a hex string")).to.throw("Input must be a hex string");
    });

    it("should throw an error if input is not 32 bytes long", () => {
      expect(() => Bytes32.fromHexString("0x1234")).to.throw("Input must be 32 bytes long.");
    });

    it("should create a Bytes32 object from a valid hex string input", () => {
      const bytes32 = Bytes32.fromHexString(VALID_HEX);
      expect(bytes32.value).to.equal(VALID_HEX);
    });
  });

  describe("toString", () => {
    it("should return the hexadecimal representation of the value", () => {
      const bytes32 = Bytes32.fromHexString(VALID_HEX);
      expect(bytes32.toString()).to.equal(bytes32.value);
    });
  });

  describe("xor", () => {
    it("should return a new Bytes32 object with the XOR of the two inputs", () => {
      const a = Bytes32.fromHexString("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
      const b = Bytes32.fromHexString("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
      const result = a.xor(b);
      expect(result.value).to.equal("0x0000000000000000000000000000000000000000000000000000000000000000");
    });
  });

  describe("random", () => {
    it("should return a valid Bytes32 object with a random value", () => {
      const randomBytes32 = Bytes32.random();
      expect(Bytes32.fromHexString(randomBytes32.value).value).to.equal(randomBytes32.value);
    });
  });
});
