import { expect } from "chai";
import { readFileSync } from "fs";
import Web3 from "web3";
import { ECDSASignature } from "../../../../libs/ftso-core/src/fsp-utils/ECDSASignature";
import { IPayloadMessage, PayloadMessage } from "../../../../libs/ftso-core/src/fsp-utils/PayloadMessage";
import {
  IProtocolMessageMerkleRoot,
  ProtocolMessageMerkleRoot,
} from "../../../../libs/ftso-core/src/fsp-utils/ProtocolMessageMerkleRoot";
import { ISignaturePayload, SignaturePayload } from "../../../../libs/ftso-core/src/fsp-utils/SignaturePayload";
import { ISigningPolicy } from "../../../../libs/ftso-core/src/fsp-utils/SigningPolicy";
import { defaultTestSigningPolicy } from "./coding-helpers";

const web3 = new Web3("http://dummy");
describe(`SignaturePayload`, () => {
  const accountPrivateKeys = JSON.parse(
    readFileSync("test/libs/unit/fsp-utils/data/test-1020-accounts.json", "utf8")
  ).map((x: { privateKey: string }) => x.privateKey);
  const accountAddresses = accountPrivateKeys.map((x: any) => web3.eth.accounts.privateKeyToAccount(x).address);

  const N = 100;
  const singleWeight = 500;
  const firstRewardEpochVotingRoundId = 1000;
  const rewardEpochDurationInEpochs = 3360; // 3.5 days
  const votingRoundId = 4111;
  const rewardEpochId = Math.floor((votingRoundId - firstRewardEpochVotingRoundId) / rewardEpochDurationInEpochs);
  let signingPolicyData: ISigningPolicy;
  let newSigningPolicyData: ISigningPolicy;

  before(async () => {
    signingPolicyData = defaultTestSigningPolicy(accountAddresses, N, singleWeight);
    signingPolicyData.rewardEpochId = rewardEpochId;
    newSigningPolicyData = { ...signingPolicyData };
    newSigningPolicyData.rewardEpochId++;
  });
  it("Should encode and decode signature payload", () => {
    const message = {
      protocolId: 15,
      votingRoundId: 1234,
      isSecureRandom: true,
      merkleRoot: "0x1122334455667788990011223344556677889900112233445566778899001122",
    } as IProtocolMessageMerkleRoot;

    const messageHash = ProtocolMessageMerkleRoot.hash(message);
    const signature = ECDSASignature.signMessageHash(messageHash, accountPrivateKeys[0]);

    const payload = {
      type: "0x00",
      message,
      signature,
      unsignedMessage: "0x1234567890",
    };

    const encoded = SignaturePayload.encode(payload);
    const decoded = SignaturePayload.decode(encoded);
    expect(decoded).to.deep.equal(payload);
  });

  it("Should encode with empty unsignedMessage", () => {
    const message = {
      protocolId: 15,
      votingRoundId: 1234,
      isSecureRandom: true,
      merkleRoot: "0x1122334455667788990011223344556677889900112233445566778899001122",
    } as IProtocolMessageMerkleRoot;

    const messageHash = ProtocolMessageMerkleRoot.hash(message);
    const signature = ECDSASignature.signMessageHash(messageHash, accountPrivateKeys[0]);

    const payload = {
      type: "0x00",
      message,
      signature,
    } as ISignaturePayload;

    expect(() => SignaturePayload.encode(payload)).not.to.throw;
    const decoded = SignaturePayload.decode(SignaturePayload.encode(payload));
    expect(decoded).to.deep.equal(payload);
    expect(SignaturePayload.decode(SignaturePayload.encode(payload).slice(2))).to.deep.equal(payload);
  });

  it("Should fail to encode wrong data", () => {
    const message = {
      protocolId: 15,
      votingRoundId: 1234,
      isSecureRandom: true,
      merkleRoot: "0x1122334455667788990011223344556677889900112233445566778899001122",
    } as IProtocolMessageMerkleRoot;

    const messageHash = ProtocolMessageMerkleRoot.hash(message);
    const signature = ECDSASignature.signMessageHash(messageHash, accountPrivateKeys[0]);

    let payload = {
      type: "00",
      message,
      signature,
      unsignedMessage: "0x1234567890",
    };
    expect(() => SignaturePayload.encode(payload)).to.throw("Invalid type format");

    payload = {
      type: "0x00",
      message,
      signature,
      unsignedMessage: "1234567890",
    };
    expect(() => SignaturePayload.encode(payload)).to.throw("Invalid unsigned message format");

    payload = {
      type: "0x00",
      message,
      signature,
      unsignedMessage: "0x123456789",
    };
    expect(() => SignaturePayload.encode(payload)).to.throw("Invalid unsigned message format");
  });

  it("Should fail to decode due to Invalid format - not hex string", async () => {
    expect(() => SignaturePayload.decode("0x1234567890yz")).to.throw("Invalid format - not hex string");
  });

  it("Should fail to decode due to Invalid format - too short", async () => {
    expect(() => SignaturePayload.decode("0x1234567890")).to.throw("Invalid format - too short");
  });

  it("Should decode call data", () => {
    let encoded = "0x12345678"; // function prefix
    const protocolId = 15;
    const votingRoundId = 1234;
    const beforeEncoding: IPayloadMessage<ISignaturePayload>[] = [];

    for (let i = 0; i < 10; i++) {
      const message = {
        protocolId,
        votingRoundId,
        isSecureRandom: true,
        merkleRoot: "0x1122334455667788990011223344556677889900112233445566778899001122",
      } as IProtocolMessageMerkleRoot;

      const messageHash = ProtocolMessageMerkleRoot.hash(message);
      const signature = ECDSASignature.signMessageHash(messageHash, accountPrivateKeys[i]);

      const payload = {
        type: "0x00",
        message,
        signature,
        unsignedMessage: "0x1234567890",
      };
      const payloadMessage = {
        protocolId,
        votingRoundId,
        payload,
      } as IPayloadMessage<ISignaturePayload>;
      beforeEncoding.push(payloadMessage);
      encoded += PayloadMessage.encode({ ...payloadMessage, payload: SignaturePayload.encode(payload) }).slice(2);
    }
    expect(SignaturePayload.decodeCalldata(encoded)).to.deep.equal(beforeEncoding);
  });

  it("Should fail to decode call data due to Invalid format - not byte sequence representing hex string", async () => {
    expect(() => SignaturePayload.decodeCalldata("0x123456yz")).to.throw(
      "Invalid format - not byte sequence representing hex string"
    );
  });

  it("Should fail to decode call data due to Invalid format - too short", async () => {
    expect(() => SignaturePayload.decodeCalldata("0x123456")).to.throw("Invalid format - too short");
  });

  it("Should verify signature payloads against signing policy", () => {
    const protocolId = 15;
    const votingRoundId = 1234;
    const messages: IPayloadMessage<ISignaturePayload>[] = [];

    for (let i = 0; i < 51; i++) {
      const message = {
        protocolId,
        votingRoundId,
        isSecureRandom: true,
        merkleRoot: "0x1122334455667788990011223344556677889900112233445566778899001122",
      } as IProtocolMessageMerkleRoot;

      const messageHash = ProtocolMessageMerkleRoot.hash(message);
      const signature = ECDSASignature.signMessageHash(messageHash, accountPrivateKeys[i]);

      const payload = {
        type: "0x00",
        message,
        signature,
        unsignedMessage: "0x1234567890",
      };
      const payloadMessage = {
        protocolId,
        votingRoundId,
        payload,
      } as IPayloadMessage<ISignaturePayload>;
      messages.push(payloadMessage);
    }

    expect(SignaturePayload.verifySignaturePayloads(messages, signingPolicyData)).to.equal(true);
    expect(SignaturePayload.verifySignaturePayloads(messages.slice(0, 50), signingPolicyData)).to.equal(false);
  });

  it("Should correctly augment signature payloads with additional data", () => {
    const protocolId = 15;
    const votingRoundId = 1234;
    const messages: ISignaturePayload[] = [];
    const signerMap = new Map<string, number>();
    const NN = 51;
    let messageHash: string = "";
    for (let i = 0; i < signingPolicyData.voters.length; i++) {
      signerMap.set(signingPolicyData.voters[i], i);
    }
    for (let i = 0; i < NN; i++) {
      const message = {
        protocolId,
        votingRoundId,
        isSecureRandom: true,
        merkleRoot: "0x1122334455667788990011223344556677889900112233445566778899001122",
      } as IProtocolMessageMerkleRoot;

      messageHash = ProtocolMessageMerkleRoot.hash(message);
      const signature = ECDSASignature.signMessageHash(messageHash, accountPrivateKeys[i]);

      const payload = {
        type: "0x00",
        message,
        signature,
        unsignedMessage: "0x1234567890",
      };
      messages.push(SignaturePayload.augment(payload, signerMap));
    }
    for (let i = 0; i < NN; i++) {
      expect(messages[i].index).to.equal(i);
      expect(messages[i].signer).to.equal(signingPolicyData.voters[i]);
      expect(messages[i].messageHash).to.equal(messageHash);
    }
  });

  it("Should correctly insert signature payloads into sorted list", () => {
    const protocolId = 15;
    const votingRoundId = 1234;
    const messages: ISignaturePayload[] = [];
    const signerMap = new Map<string, number>();
    const NN = 51;
    let messageHash: string = "";
    for (let i = 0; i < signingPolicyData.voters.length; i++) {
      signerMap.set(signingPolicyData.voters[i], i);
    }
    const sortedList: ISignaturePayload[] = [];

    function checkIfSortedAndIndexIsInserted(list: ISignaturePayload[], i: number): boolean {
      let isIn = false;
      for (let j = 0; j < list.length; j++) {
        if (list[j].index === i) {
          isIn = true;
        }
        if (j < list.length - 1 && list[j].index >= list[j + 1].index) {
          return false;
        }
      }
      return isIn;
    }

    for (let i = 0; i < NN; i++) {
      const randomSignerIndex = Math.floor(Math.random() * signingPolicyData.voters.length);
      const message = {
        protocolId,
        votingRoundId,
        isSecureRandom: true,
        merkleRoot: "0x1122334455667788990011223344556677889900112233445566778899001122",
      } as IProtocolMessageMerkleRoot;

      messageHash = ProtocolMessageMerkleRoot.hash(message);
      const signature = ECDSASignature.signMessageHash(messageHash, accountPrivateKeys[randomSignerIndex]);

      const payload = {
        type: "0x00",
        message,
        signature,
        unsignedMessage: "0x1234567890",
      };

      const augmented = SignaturePayload.augment(payload, signerMap);
      expect(augmented.index).to.equal(randomSignerIndex);
      SignaturePayload.insertInSigningPolicySortedList(sortedList, augmented);
      expect(checkIfSortedAndIndexIsInserted(sortedList, augmented.index)).to.equal(true);
    }
  });
});
