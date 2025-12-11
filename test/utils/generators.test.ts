import { expect } from "chai";
import { generateEvent } from "./basic-generators";
import { decodeEvent } from "../../libs/contracts/src/abi/AbiCache";
import { CONTRACTS } from "../../libs/contracts/src/constants";

describe("generators", () => {
  // Event ABI example
  // const eventABI = {
  //    "anonymous": false,
  //    "inputs": [
  //       {
  //          "indexed": true,
  //          "internalType": "uint8",
  //          "name": "protocolId",
  //          "type": "uint8"
  //       },
  //       {
  //          "indexed": true,
  //          "internalType": "uint32",
  //          "name": "votingRoundId",
  //          "type": "uint32"
  //       },
  //       {
  //          "indexed": false,
  //          "internalType": "bool",
  //          "name": "isSecureRandom",
  //          "type": "bool"
  //       },
  //       {
  //          "indexed": false,
  //          "internalType": "bytes32",
  //          "name": "merkleRoot",
  //          "type": "bytes32"
  //       }
  //    ],
  //    "name": "ProtocolMessageRelayed",
  //    "type": "event"
  // }

  it("should encode and decode event correctly", () => {
    const eventData = {
      protocolId: 1n,
      votingRoundId: 2n,
      isSecureRandom: false,
      merkleRoot: "0x" + "a".repeat(64),
    };
    const eventEntity = generateEvent(
      CONTRACTS.Relay,
      "ProtocolMessageRelayed",
      eventData,
      1,
      Math.floor(Date.now() / 1000)
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    const decoded = decodeEvent<any>(CONTRACTS.Relay.name, "ProtocolMessageRelayed", eventEntity, (data: any) => data);
    expect(decoded.protocolId).to.be.equal(eventData.protocolId);
    expect(decoded.votingRoundId).to.be.equal(eventData.votingRoundId);
    expect(decoded.isSecureRandom).to.be.equal(eventData.isSecureRandom);
    expect(decoded.merkleRoot).to.be.equal(eventData.merkleRoot);
  });
});
