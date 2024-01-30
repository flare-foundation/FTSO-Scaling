import { expect } from "chai";
import Web3 from "web3";
import { IPayloadMessage, PayloadMessage } from "../../../../libs/fsp-utils/src/PayloadMessage";

describe(`PayloadMessage`, async () => {
  it("Should encode and decode payload message", async () => {
    const payloads: IPayloadMessage<string>[] = [];
    const N = 10;
    let encoded = "0x";
    for (let i = 0; i < N; i++) {
      const payload = {
        protocolId: i,
        votingRoundId: 10 * i,
        payload: Web3.utils.randomHex(2 * (N - i)),
      } as IPayloadMessage<string>;
      payloads.push(payload);
      encoded += PayloadMessage.encode(payload).slice(2);
    }
    const decoded = PayloadMessage.decode(encoded);
    expect(decoded).to.deep.equal(payloads);
    expect(PayloadMessage.decode(encoded.slice(2))).to.deep.equal(payloads);
  });

  it("Should concatenate hex strings correctly", async () => {
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

  it("Should fail to encode due to protocol id out of range", async () => {
    let payload = {
      protocolId: -1,
      votingRoundId: 1000,
      payload: Web3.utils.randomHex(20),
    } as IPayloadMessage<string>;
    expect(() => PayloadMessage.encode(payload)).to.throw("Protocol id out of range");
    payload = { ...payload, protocolId: 256 };
    expect(() => PayloadMessage.encode(payload)).to.throw("Protocol id out of range");
  });

  it("Should fail to encode due to voting round id out of range", async () => {
    let payload = {
      protocolId: 15,
      votingRoundId: -10,
      payload: Web3.utils.randomHex(20),
    } as IPayloadMessage<string>;
    expect(() => PayloadMessage.encode(payload)).to.throw("Voting round id out of range");
    payload = { ...payload, votingRoundId: 2 ** 32 };
    expect(() => PayloadMessage.encode(payload)).to.throw("Voting round id out of range");
  });

  it("Should fail to encode due to invalid payload format", async () => {
    let payload = {
      protocolId: 15,
      votingRoundId: 10,
      payload: "00",
    } as IPayloadMessage<string>;
    expect(() => PayloadMessage.encode(payload)).to.throw("Invalid payload format");
    payload = { ...payload, payload: "0x1234rt" };
    expect(() => PayloadMessage.encode(payload)).to.throw("Invalid payload format");
  });

  it("Should fail to decode due invalid format - not hex string", async () => {
    expect(() => PayloadMessage.decode("0x001234yz")).to.throw("Invalid format - not hex string");
  });

  it("Should fail to decode due to invalid format - not even length", async () => {
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

  it("Should fail to decode due to Invalid format - too short", async () => {
    const payload = {
      protocolId: 15,
      votingRoundId: 10,
      payload: "0x001234",
    } as IPayloadMessage<string>;
    const encoded = PayloadMessage.encode(payload);
    expect(() => PayloadMessage.decode(encoded.slice(0, encoded.length - 2))).to.throw("Invalid format - too short");
  });
});
