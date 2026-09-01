import { expect } from "chai";
import { ethers } from "ethers";
import {
  IProtocolMessageMerkleRoot,
  ProtocolMessageMerkleRoot,
} from "../../../../libs/ftso-core/src/fsp-utils/ProtocolMessageMerkleRoot";
import { getTestFile } from "../../../utils/getTestFile";

describe(`ProtocolMessageMerkleRoot (${getTestFile(__filename)})`, () => {
  it("roundtrips a protocol message merkle root through encode/decode", async () => {
    const messageData = {
      protocolId: 15,
      votingRoundId: 1234,
      isSecureRandom: true,
      merkleRoot: "0x1122334455667788990011223344556677889900112233445566778899001122",
    } as IProtocolMessageMerkleRoot;
    const encoded = ProtocolMessageMerkleRoot.encode(messageData);
    const decoded = ProtocolMessageMerkleRoot.decode(encoded);
    expect(decoded).to.deep.equal(messageData);
    const decoded2 = ProtocolMessageMerkleRoot.decode(encoded + "123456", false);
    expect(decoded2).to.deep.equal({ ...decoded, encodedLength: encoded.length - 2 });
  });

  it("compares equal messages as equal and detects field-level differences", async () => {
    const messageData = {
      protocolId: 15,
      votingRoundId: 1234,
      isSecureRandom: true,
      merkleRoot: "0x1122334455667788990011223344556677889900112233445566778899001122",
    } as IProtocolMessageMerkleRoot;
    expect(ProtocolMessageMerkleRoot.equals(messageData, messageData)).to.be.true;
    let newMessageData = { ...messageData, protocolId: 16 };
    expect(ProtocolMessageMerkleRoot.equals(messageData, newMessageData)).to.be.false;
    newMessageData = { ...messageData, votingRoundId: 1235 };
    expect(ProtocolMessageMerkleRoot.equals(messageData, newMessageData)).to.be.false;
    newMessageData = { ...messageData, isSecureRandom: false };
    expect(ProtocolMessageMerkleRoot.equals(messageData, newMessageData)).to.be.false;
  });

  it("produces a 32-byte hex hash", async () => {
    const messageData = {
      protocolId: 15,
      votingRoundId: 1234,
      isSecureRandom: true,
      merkleRoot: "0x1122334455667788990011223344556677889900112233445566778899001122",
    } as IProtocolMessageMerkleRoot;
    expect(ProtocolMessageMerkleRoot.hash(messageData).length).to.equal(66);
  });

  it("rejects encode when merkle root is malformed", async () => {
    let messageData = {
      protocolId: 15,
      votingRoundId: 1234,
      isSecureRandom: true,
      merkleRoot: "1122334455667788990011223344556677889900112233445566778899001122",
    } as IProtocolMessageMerkleRoot;
    expect(() => ProtocolMessageMerkleRoot.encode(messageData)).to.throw("Invalid merkle root format");

    messageData = {
      protocolId: 15,
      votingRoundId: 1234,
      isSecureRandom: true,
      merkleRoot: "0x112233445566778899001122334455667788990011223344556677889900",
    } as IProtocolMessageMerkleRoot;
    expect(() => ProtocolMessageMerkleRoot.encode(messageData)).to.throw("Invalid merkle root format");

    messageData = {
      protocolId: 15,
      votingRoundId: 1234,
      isSecureRandom: true,
      merkleRoot: "0x1122334455667788990011yy3344556677889900112233445566778899001122",
    } as IProtocolMessageMerkleRoot;
    expect(() => ProtocolMessageMerkleRoot.encode(messageData)).to.throw("Invalid merkle root format");
  });

  it("rejects encode when protocol id is out of range", async () => {
    let messageData = {
      protocolId: -3,
      votingRoundId: 1234,
      isSecureRandom: true,
      merkleRoot: "0x1122334455667788990011223344556677889900112233445566778899001122",
    } as IProtocolMessageMerkleRoot;
    expect(() => ProtocolMessageMerkleRoot.encode(messageData).length).to.throw("Protocol id out of range");
    messageData = {
      protocolId: 266,
      votingRoundId: 1234,
      isSecureRandom: true,
      merkleRoot: "0x1122334455667788990011223344556677889900112233445566778899001122",
    } as IProtocolMessageMerkleRoot;
    expect(() => ProtocolMessageMerkleRoot.encode(messageData).length).to.throw("Protocol id out of range");
  });

  it("rejects encode when voting round id is out of range", async () => {
    const messageData = {
      protocolId: 15,
      votingRoundId: -3,
      isSecureRandom: true,
      merkleRoot: "0x1122334455667788990011223344556677889900112233445566778899001122",
    } as IProtocolMessageMerkleRoot;
    expect(() => ProtocolMessageMerkleRoot.encode(messageData).length).to.throw("Voting round id out of range");
  });

  // Relay v2 verifies keccak256(chainId ‖ message) where the relays before it verify keccak256(message).
  // Reward calculation needs both, so the chain id is optional and its absence must reproduce the legacy digest.
  it("binds the source chain id into the digest only when one is given", () => {
    const message: IProtocolMessageMerkleRoot = {
      protocolId: 100,
      votingRoundId: 4111,
      isSecureRandom: true,
      merkleRoot: "0x" + "ab".repeat(32),
    };
    const encoded = ProtocolMessageMerkleRoot.encode(message);

    expect(ProtocolMessageMerkleRoot.hash(message)).to.equal(ethers.keccak256(encoded));
    for (const chainId of [14, 19]) {
      expect(ProtocolMessageMerkleRoot.hash(message, chainId)).to.equal(
        ethers.keccak256(ethers.solidityPacked(["uint256", "bytes"], [chainId, encoded]))
      );
    }
    expect(ProtocolMessageMerkleRoot.hash(message, 14)).to.not.equal(ProtocolMessageMerkleRoot.hash(message, 19));
    expect(ProtocolMessageMerkleRoot.hash(message, 14)).to.not.equal(ProtocolMessageMerkleRoot.hash(message));
  });
});
