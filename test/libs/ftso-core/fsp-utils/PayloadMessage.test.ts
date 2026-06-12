import { expect } from "chai";
import { hexlify, randomBytes } from "ethers";
import { IPayloadMessage, PayloadMessage } from "../../../../libs/ftso-core/src/fsp-utils/PayloadMessage";
import { getTestFile } from "../../../utils/getTestFile";

describe(`PayloadMessage (${getTestFile(__filename)})`, () => {
  it("roundtrips a batch of payload messages through encode/decode", async () => {
    const payloads: IPayloadMessage<string>[] = [];
    const N = 10;
    let encoded = "0x";
    for (let i = 0; i < N; i++) {
      const payload = {
        protocolId: i,
        votingRoundId: 10 * i,
        payload: hexlify(randomBytes(2 * (N - i))),
      } as IPayloadMessage<string>;
      payloads.push(payload);
      encoded += PayloadMessage.encode(payload).slice(2);
    }
    const decoded = PayloadMessage.decode(encoded);
    expect(decoded).to.deep.equal(payloads);
    expect(PayloadMessage.decode(encoded.slice(2))).to.deep.equal(payloads);
  });

  it("concatenates hex strings, stripping subsequent 0x prefixes", async () => {
    const hex1 = "0x1234";
    const hex2 = "0x5678";
    const hex3 = "0x9abc";
    const hex4 = "0xdef0";
    const hex5 = "0x123456789abcdef0";
    const hex6 = "0x123456789abcdef0123456789abcdef0";
    const result = PayloadMessage.concatenateHexStrings([hex1, hex2, hex3, hex4, hex5, hex6]);
    expect(result).to.equal(hex1 + hex2.slice(2) + hex3.slice(2) + hex4.slice(2) + hex5.slice(2) + hex6.slice(2));
    expect(PayloadMessage.concatenateHexStrings([])).to.equal("0x");
    expect(PayloadMessage.concatenateHexStrings(["0x"])).to.equal("0x");
    expect(PayloadMessage.concatenateHexStrings([hex1])).to.equal(hex1);
  });

  it("rejects encode when protocol id is out of range", async () => {
    let payload = {
      protocolId: -1,
      votingRoundId: 1000,
      payload: hexlify(randomBytes(20)),
    } as IPayloadMessage<string>;
    expect(() => PayloadMessage.encode(payload)).to.throw("Protocol id out of range");
    payload = { ...payload, protocolId: 256 };
    expect(() => PayloadMessage.encode(payload)).to.throw("Protocol id out of range");
  });

  it("rejects encode when voting round id is out of range", async () => {
    let payload = {
      protocolId: 15,
      votingRoundId: -10,
      payload: hexlify(randomBytes(20)),
    } as IPayloadMessage<string>;
    expect(() => PayloadMessage.encode(payload)).to.throw("Voting round id out of range");
    payload = { ...payload, votingRoundId: 2 ** 32 };
    expect(() => PayloadMessage.encode(payload)).to.throw("Voting round id out of range");
  });

  it("rejects encode when payload format is invalid", async () => {
    let payload = {
      protocolId: 15,
      votingRoundId: 10,
      payload: "00",
    } as IPayloadMessage<string>;
    expect(() => PayloadMessage.encode(payload)).to.throw("Invalid payload format");
    payload = { ...payload, payload: "0x1234rt" };
    expect(() => PayloadMessage.encode(payload)).to.throw("Invalid payload format");
  });

  it("rejects decode when input is not a hex string", async () => {
    expect(() => PayloadMessage.decode("0x001234yz")).to.throw("Invalid format - not hex string");
  });

  it("rejects decode when a tail segment is shorter than its declared length", async () => {
    const payload = {
      protocolId: 15,
      votingRoundId: 10,
      payload: "0x001234",
    } as IPayloadMessage<string>;

    const encoded = PayloadMessage.encode(payload);
    const oneMore = "0x123456"; // too short encoding
    const fullMessage = PayloadMessage.concatenateHexStrings([encoded, oneMore]);
    expect(() => PayloadMessage.decode(fullMessage)).to.throw("Invalid format - too short. Error at");
  });

  it("rejects decode when overall input is too short", async () => {
    const payload = {
      protocolId: 15,
      votingRoundId: 10,
      payload: "0x001234",
    } as IPayloadMessage<string>;
    const encoded = PayloadMessage.encode(payload);
    expect(() => PayloadMessage.decode(encoded.slice(0, encoded.length - 2))).to.throw("Invalid format - too short");
  });
});
