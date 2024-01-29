import { expect } from "chai";
import { IProtocolMessageMerkleRoot, ProtocolMessageMerkleRoot } from "../../../../libs/fsp-utils/src/ProtocolMessageMerkleRoot";

describe(`ProtocolMessageMerkleRoot`, async () => {

  it("Should encode and decode protocol message merkle root", async () => {
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


  it("Should equals work", async () => {
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

  it("Should produce a hash", async () => {
    const messageData = {
      protocolId: 15,
      votingRoundId: 1234,
      isSecureRandom: true,
      merkleRoot: "0x1122334455667788990011223344556677889900112233445566778899001122",
    } as IProtocolMessageMerkleRoot;
    expect(ProtocolMessageMerkleRoot.hash(messageData).length).to.equal(66);
  });

  it("Should fail to encode due to wrong merkle root", async () => {
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

  it("Should fail to wrong protocol id", async () => {
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

  it("Should fail to wrong voting round id", async () => {
    let messageData = {
      protocolId: 15,
      votingRoundId: -3,
      isSecureRandom: true,
      merkleRoot: "0x1122334455667788990011223344556677889900112233445566778899001122",
    } as IProtocolMessageMerkleRoot;
    expect(() => ProtocolMessageMerkleRoot.encode(messageData).length).to.throw("Voting round id out of range");
  });

});
