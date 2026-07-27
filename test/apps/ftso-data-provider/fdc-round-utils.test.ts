import { expect } from "chai";
import { AttestationRequest } from "../../../libs/contracts/src/events/AttestationRequest";
import {
  bitVoteIndicesNum,
  decodeAttestationTypeAndSource,
  parseBitVotePayload,
  toBitVector,
  uniqueRequestsIndices,
} from "../../../apps/ftso-data-provider/src/fdc/fdc-round-utils";
import { getTestFile } from "../../utils/getTestFile";

function request(data: string): AttestationRequest {
  return new AttestationRequest({ data, fee: 0 }, 1);
}

function encodeBytes32Utf8(value: string): string {
  return Buffer.from(value, "utf8").toString("hex").padEnd(64, "0");
}

describe(`fdc-round-utils (${getTestFile(__filename)})`, () => {
  describe("uniqueRequestsIndices", () => {
    it("groups byte-identical requests with the first occurrence as representative", () => {
      const requests = [request("0xaa"), request("0xbb"), request("0xaa"), request("0xcc"), request("0xbb")];
      expect(uniqueRequestsIndices(requests)).to.deep.equal([[0, 2], [1, 4], [3]]);
    });

    it("treats requests sharing the 64-byte prefix but differing later as distinct", () => {
      const prefix = encodeBytes32Utf8("Payment") + encodeBytes32Utf8("XRP");
      const requests = [request("0x" + prefix + "01"), request("0x" + prefix + "02")];
      expect(uniqueRequestsIndices(requests)).to.deep.equal([[0], [1]]);
    });

    it("returns empty for no requests", () => {
      expect(uniqueRequestsIndices([])).to.deep.equal([]);
    });
  });

  describe("parseBitVotePayload", () => {
    it("parses a valid bitvote", () => {
      // 3 requests, bits 0b101
      expect(parseBitVotePayload("0x000305")).to.deep.equal({ declaredCount: 3, bits: 5n });
    });

    it("parses an empty bitvote for a round with zero requests", () => {
      expect(parseBitVotePayload("0x0000")).to.deep.equal({ declaredCount: 0, bits: 0n });
    });

    it("is case insensitive on hex digits", () => {
      expect(parseBitVotePayload("0x00020A")).to.deep.equal({ declaredCount: 2, bits: 10n });
    });

    it("returns the declared count as-is; mismatch policy is the caller's concern", () => {
      expect(parseBitVotePayload("0x000405")).to.deep.equal({ declaredCount: 4, bits: 5n });
    });

    it("throws on malformed payloads", () => {
      expect(() => parseBitVotePayload("0x00")).to.throw("Malformed");
      expect(() => parseBitVotePayload("0x000z05")).to.throw("Malformed");
      expect(() => parseBitVotePayload("0x00005")).to.throw("Malformed"); // odd length
      expect(() => parseBitVotePayload("no-hex")).to.throw("Malformed");
    });
  });

  describe("bitVoteIndicesNum", () => {
    it("maps bits LSB-first to request indices", () => {
      expect(bitVoteIndicesNum(0b101n, 3)).to.deep.equal([0, 2]);
      expect(bitVoteIndicesNum(0n, 3)).to.deep.equal([]);
    });

    it("throws when bits beyond the request count are set", () => {
      expect(() => bitVoteIndicesNum(0b1000n, 3)).to.throw("not fully consumed");
    });
  });

  describe("decodeAttestationTypeAndSource", () => {
    it("decodes zero-padded utf8 type and source", () => {
      const data = "0x" + encodeBytes32Utf8("Payment") + encodeBytes32Utf8("XRP") + "1234";
      expect(decodeAttestationTypeAndSource(data)).to.deep.equal({
        attestation_type: "Payment",
        source_id: "XRP",
      });
    });

    it("returns nulls for data shorter than 64 bytes", () => {
      expect(decodeAttestationTypeAndSource("0x1234")).to.deep.equal({
        attestation_type: null,
        source_id: null,
      });
    });
  });

  describe("toBitVector", () => {
    it("expands indices into a boolean vector", () => {
      expect(toBitVector([0, 2], 4)).to.deep.equal([true, false, true, false]);
      expect(toBitVector([], 0)).to.deep.equal([]);
    });
  });
});
