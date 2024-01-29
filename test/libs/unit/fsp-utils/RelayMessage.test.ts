import { expect } from "chai";
import { ethers } from "ethers";
import { readFileSync } from "fs";
import Web3 from "web3";
import { IProtocolMessageMerkleRoot, ProtocolMessageMerkleRoot } from "../../../../libs/fsp-utils/src/ProtocolMessageMerkleRoot";
import { RelayMessage } from "../../../../libs/fsp-utils/src/RelayMessage";
import { ISigningPolicy } from "../../../../libs/fsp-utils/src/SigningPolicy";
import { defaultTestSigningPolicy, generateSignatures } from "./coding-helpers";

const web3 = new Web3("https://dummy");
describe(`RelayMessage`, async () => {
  
  const accountPrivateKeys = JSON.parse(readFileSync("test/libs/unit/fsp-utils/data/test-1020-accounts.json", "utf8")).map((x: any) => x.privateKey);
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
    signingPolicyData = defaultTestSigningPolicy(
      accountAddresses,
      N,
      singleWeight
    );
    signingPolicyData.rewardEpochId = rewardEpochId;
    newSigningPolicyData = {...signingPolicyData};
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
    const signatures = await generateSignatures(
      accountPrivateKeys,
      messageHash,
      N / 2 + 1
    );

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

});
