import { expect } from "chai";
import { ethers } from "ethers";
import { readFileSync } from "fs";
import Web3 from "web3";
import {
  IProtocolMessageMerkleRoot,
  ProtocolMessageMerkleRoot,
} from "../../../../libs/ftso-core/src/fsp-utils/ProtocolMessageMerkleRoot";
import { IRelayMessage, RelayMessage } from "../../../../libs/ftso-core/src/fsp-utils/RelayMessage";
import { ISigningPolicy } from "../../../../libs/ftso-core/src/fsp-utils/SigningPolicy";
import { defaultTestSigningPolicy, generateSignatures } from "./coding-helpers";
import e from "express";

const web3 = new Web3("https://dummy");
describe(`RelayMessage`, async () => {
  const accountPrivateKeys = JSON.parse(
    readFileSync("test/libs/unit/fsp-utils/data/test-1020-accounts.json", "utf8")
  ).map((x: any) => x.privateKey);
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

  it("Should encode and decode Relay message", async () => {
    const merkleRoot = ethers.hexlify(ethers.randomBytes(32));
    const messageData = {
      protocolId: 15,
      votingRoundId,
      isSecureRandom: true,
      merkleRoot,
    } as IProtocolMessageMerkleRoot;

    const messageHash = ProtocolMessageMerkleRoot.hash(messageData);
    const signatures = await generateSignatures(accountPrivateKeys, messageHash, N / 2 + 1);

    const relayMessage = {
      signingPolicy: signingPolicyData,
      signatures,
      protocolMessageMerkleRoot: messageData,
    };

    let fullData = RelayMessage.encode(relayMessage);
    expect(RelayMessage.decode(fullData)).not.to.throw;
    let decodedRelayMessage = RelayMessage.decode(fullData);
    expect(RelayMessage.equals(relayMessage, decodedRelayMessage)).to.be.true;

    const relayMessage2 = {
      signingPolicy: signingPolicyData,
      signatures,
      newSigningPolicy: newSigningPolicyData,
    };

    expect(RelayMessage.equals(relayMessage, relayMessage2)).to.be.false;
    fullData = RelayMessage.encode(relayMessage2);
    expect(RelayMessage.decode(fullData)).not.to.throw;
    decodedRelayMessage = RelayMessage.decode(fullData);
    expect(RelayMessage.equals(relayMessage2, decodedRelayMessage)).to.be.true;
  });

  it("Should equals work", async () => {
    const merkleRoot = ethers.hexlify(ethers.randomBytes(32));
    const messageData = {
      protocolId: 15,
      votingRoundId,
      isSecureRandom: true,
      merkleRoot,
    } as IProtocolMessageMerkleRoot;
    const messageData3 = {
      protocolId: 16,
      votingRoundId,
      isSecureRandom: true,
      merkleRoot,
    } as IProtocolMessageMerkleRoot;

    const messageHash = ProtocolMessageMerkleRoot.hash(messageData);
    const signatures = await generateSignatures(accountPrivateKeys, messageHash, N / 2 + 1);
    const signatures2 = await generateSignatures(accountPrivateKeys, messageHash, N / 2 + 2);
    const signingPolicyData2 = defaultTestSigningPolicy(accountAddresses, N - 1, singleWeight);
    const relayMessage = {
      signingPolicy: signingPolicyData,
      signatures,
      protocolMessageMerkleRoot: messageData,
    };
    const relayMessage2 = {
      signingPolicy: signingPolicyData,
      signatures: signatures2,
      protocolMessageMerkleRoot: messageData,
    };
    const relayMessage3 = {
      signingPolicy: signingPolicyData,
      signatures: signatures,
      protocolMessageMerkleRoot: messageData3,
    };
    const relayMessage4 = {
      signingPolicy: signingPolicyData2,
      signatures: signatures,
      protocolMessageMerkleRoot: messageData,
    };
    const relayMessage5 = {
      signingPolicy: signingPolicyData,
      signatures: signatures2.slice(1),
      protocolMessageMerkleRoot: messageData,
    };
    const relayMessage6 = {
      signatures: signatures2.slice(1),
      protocolMessageMerkleRoot: messageData,
    } as IRelayMessage;

    const relayMessage7 = {
      signingPolicy: signingPolicyData,
      signatures: signatures2.slice(1),
    } as IRelayMessage;
    const relayMessage8 = {
      signingPolicy: signingPolicyData,
      signatures,
      newSigningPolicy: signingPolicyData2,
    };
    const relayMessage9: IRelayMessage = {
      signingPolicy: signingPolicyData,
      signatures,
      newSigningPolicy: signingPolicyData,
    };

    expect(RelayMessage.equals(relayMessage, relayMessage)).to.be.true;
    expect(RelayMessage.equals(relayMessage, relayMessage2)).to.be.false;
    expect(RelayMessage.equals(relayMessage, relayMessage3)).to.be.false;
    expect(RelayMessage.equals(relayMessage, relayMessage4)).to.be.false;
    expect(RelayMessage.equals(relayMessage, relayMessage5)).to.be.false;
    expect(RelayMessage.equals(relayMessage, relayMessage6)).to.be.false;
    expect(RelayMessage.equals(relayMessage, relayMessage7)).to.be.false;
    expect(RelayMessage.equals(relayMessage8, relayMessage8)).to.be.true;
    expect(RelayMessage.equals(relayMessage, relayMessage8)).to.be.false;
    expect(RelayMessage.equals(relayMessage9, relayMessage8)).to.be.false;
  });

  it("Should encode and verify", async () => {
    const merkleRoot = ethers.hexlify(ethers.randomBytes(32));
    const messageData = {
      protocolId: 15,
      votingRoundId,
      isSecureRandom: true,
      merkleRoot,
    } as IProtocolMessageMerkleRoot;

    const messageHash = ProtocolMessageMerkleRoot.hash(messageData);
    const signatures = await generateSignatures(accountPrivateKeys, messageHash, N / 2);

    const relayMessage = {
      signingPolicy: signingPolicyData,
      signatures,
      protocolMessageMerkleRoot: messageData,
    };
    expect(() => RelayMessage.encode(relayMessage, true)).to.throw("Invalid relay message: threshold not met");
  });
});
