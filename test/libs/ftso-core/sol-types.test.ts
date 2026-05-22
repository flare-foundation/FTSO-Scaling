import { expect } from "chai";
import { Bytes32 } from "../../../libs/ftso-core/src/utils/sol-types";
import { getTestFile } from "../../utils/getTestFile";

describe(`Bytes32 (${getTestFile(__filename)})`, () => {
  const VALID_HEX = "0x" + "01".repeat(32);

  describe("fromHexString", () => {
    it("rejects input that is not a hex string", () => {
      expect(() => Bytes32.fromHexString("not a hex string")).to.throw("Input must be a hex string");
    });

    it("rejects input that is not 32 bytes long", () => {
      expect(() => Bytes32.fromHexString("0x1234")).to.throw("Input must be 32 bytes long.");
    });

    it("constructs a Bytes32 from a valid 32-byte hex string", () => {
      const bytes32 = Bytes32.fromHexString(VALID_HEX);
      expect(bytes32.value).to.equal(VALID_HEX);
    });
  });

  describe("toString", () => {
    it("returns the hex-string value", () => {
      const bytes32 = Bytes32.fromHexString(VALID_HEX);
      expect(bytes32.toString()).to.equal(bytes32.value);
    });
  });

  describe("xor", () => {
    it("returns the bitwise XOR of two Bytes32 values", () => {
      const a = Bytes32.fromHexString("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
      const b = Bytes32.fromHexString("0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
      const result = a.xor(b);
      expect(result.value).to.equal("0x0000000000000000000000000000000000000000000000000000000000000000");
    });
  });

  describe("random", () => {
    it("returns a valid Bytes32 whose value roundtrips through fromHexString", () => {
      const randomBytes32 = Bytes32.random();
      expect(Bytes32.fromHexString(randomBytes32.value).value).to.equal(randomBytes32.value);
    });
  });
});
