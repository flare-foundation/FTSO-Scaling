import { expect } from "chai";
import { readFileSync } from "fs";
import Web3 from "web3";
import { ISigningPolicy, SigningPolicy } from "../../../../libs/ftso-core/src/fsp-utils/SigningPolicy";
import { defaultTestSigningPolicy } from "./coding-helpers";

const web3 = new Web3("https://dummy");
describe(`SigningPolicy`, () => {
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

  it("Should encode and decode signing policy", async () => {
    const encoded = SigningPolicy.encode(signingPolicyData);
    const decoded = SigningPolicy.decode(encoded);
    expect(decoded).to.deep.equal(signingPolicyData);
    const decoded2 = SigningPolicy.decode(encoded + "123456", false);
    expect(decoded2).to.deep.equal({ ...decoded, encodedLength: encoded.length - 2 });
  });

  it("Should equals work", async () => {
    expect(SigningPolicy.equals(signingPolicyData, signingPolicyData)).to.be.true;
    expect(SigningPolicy.equals(signingPolicyData, newSigningPolicyData)).to.be.false;
  });

  it("Should produce hash", async () => {
    expect(SigningPolicy.hash(signingPolicyData).length).to.equal(66);
  });

  it("Should normalize addresses", async () => {
    const signingPolicyData2 = {
      ...signingPolicyData,
      voters: signingPolicyData.voters.map((x) => x.toUpperCase()),
    };
    SigningPolicy.normalizeAddresses(signingPolicyData2);
    for (let i = 0; i < signingPolicyData.voters.length; i++) {
      expect(signingPolicyData2.voters[i]).to.equal(signingPolicyData.voters[i].toLowerCase());
    }
  });

  it("Should fail to encode due to undefined signing policy", async () => {
    expect(() => SigningPolicy.encode(undefined as any)).to.throw("Signing policy is undefined");
  });

  it("Should fail to encode due to no voters", async () => {
    const signingPolicyData2 = { ...signingPolicyData, voters: undefined };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Invalid signing policy");
  });

  it("Should fail to encode due to no weights", async () => {
    const signingPolicyData2 = { ...signingPolicyData, weights: undefined };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Invalid signing policy");
  });

  it("Should fail to encode mismatch in voters and weights length", async () => {
    const signingPolicyData2 = { ...signingPolicyData, weights: [...signingPolicyData.weights, 100] };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Invalid signing policy");
  });

  it("Should fail to encode due to too many voters", async () => {
    const longArray = new Array(66000).fill("0x00");
    const signingPolicyData2 = { ...signingPolicyData, voters: longArray, weights: longArray as any };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Too many signers");
  });

  it("Should fail to encode due to invalid voter address", async () => {
    let signingPolicyData2 = {
      ...signingPolicyData,
      weights: [...signingPolicyData.weights, 100],
      voters: [...signingPolicyData.voters, "0x00"],
    };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Invalid signer address format");
    signingPolicyData2 = {
      ...signingPolicyData,
      weights: [...signingPolicyData.weights, 100],
      voters: [...signingPolicyData.voters, "00"],
    };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Invalid signer address format");
    signingPolicyData2 = {
      ...signingPolicyData,
      weights: [...signingPolicyData.weights, 100],
      voters: [...signingPolicyData.voters, "0xc783df8a850f42e7f7e57013759c285caa701ebY"],
    };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Invalid signer address format");
  });

  it("Should fail to encode due to invalid voter weight", async () => {
    let signingPolicyData2 = {
      ...signingPolicyData,
      weights: [...signingPolicyData.weights, 66000],
      voters: [...signingPolicyData.voters, "0xc783df8a850f42e7f7e57013759c285caa701eba"],
    };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Invalid signer weight");
    signingPolicyData2 = {
      ...signingPolicyData,
      weights: [...signingPolicyData.weights, -3],
      voters: [...signingPolicyData.voters, "0xc783df8a850f42e7f7e57013759c285caa701eba"],
    };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Invalid signer weight");
    signingPolicyData2 = {
      ...signingPolicyData,
      weights: [...signingPolicyData.weights, 3.14],
      voters: [...signingPolicyData.voters, "0xc783df8a850f42e7f7e57013759c285caa701eba"],
    };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Invalid signer weight");
  });

  it("Should fail to encode due to invalid seed format", async () => {
    let signingPolicyData2 = { ...signingPolicyData, seed: "00" };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Invalid random seed format");
    signingPolicyData2 = { ...signingPolicyData, seed: "0x00" };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Invalid random seed format");
    signingPolicyData2 = {
      ...signingPolicyData,
      seed: "0x23c601ae397441f3ef6f1075dcb0031ff17fb079837beadaf3c84d96c6f3e56x",
    };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Invalid random seed format");
  });

  it("Should fail to encode due to invalid reward epoch", async () => {
    let signingPolicyData2 = { ...signingPolicyData, rewardEpochId: -3 };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Reward epoch id out of range");
    signingPolicyData2 = { ...signingPolicyData, rewardEpochId: 2 ** 25 };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Reward epoch id out of range");
    signingPolicyData2 = { ...signingPolicyData, rewardEpochId: 3.14 };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Reward epoch id out of range");
  });

  it("Should fail to encode due to invalid startingVotingRound", async () => {
    let signingPolicyData2 = { ...signingPolicyData, startVotingRoundId: -3 };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Starting voting round id out of range");
    signingPolicyData2 = { ...signingPolicyData, startVotingRoundId: 2 ** 32 };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Starting voting round id out of range");
    signingPolicyData2 = { ...signingPolicyData, startVotingRoundId: 3.14 };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Starting voting round id out of range");
  });

  it("Should fail to encode due to threshold out of range", async () => {
    let signingPolicyData2 = { ...signingPolicyData, threshold: -3 };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Threshold out of range");
    signingPolicyData2 = { ...signingPolicyData, threshold: 2 ** 32 };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Threshold out of range");
    signingPolicyData2 = { ...signingPolicyData, threshold: 3.14 };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Threshold out of range");
  });
});
