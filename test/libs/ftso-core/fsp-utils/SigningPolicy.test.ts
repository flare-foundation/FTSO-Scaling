import { expect } from "chai";
import { readFileSync } from "fs";
import Web3 from "web3";
import { ISigningPolicy, SigningPolicy } from "../../../../libs/ftso-core/src/fsp-utils/SigningPolicy";
import { getTestFile } from "../../../utils/getTestFile";
import { defaultTestSigningPolicy } from "./coding-helpers";

const web3 = new Web3("https://dummy");
describe(`SigningPolicy (${getTestFile(__filename)})`, () => {
  const accountPrivateKeys = JSON.parse(
    readFileSync("test/libs/ftso-core/fsp-utils/data/test-1020-accounts.json", "utf8")
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

  it("roundtrips a signing policy through encode/decode", async () => {
    const encoded = SigningPolicy.encode(signingPolicyData);
    const decoded = SigningPolicy.decode(encoded);
    expect(decoded).to.deep.equal(signingPolicyData);
    const decoded2 = SigningPolicy.decode(encoded + "123456", false);
    expect(decoded2).to.deep.equal({ ...decoded, encodedLength: encoded.length - 2 });
  });

  it("treats identical policies as equal and differing rewardEpochId as unequal", async () => {
    expect(SigningPolicy.equals(signingPolicyData, signingPolicyData)).to.be.true;
    expect(SigningPolicy.equals(signingPolicyData, newSigningPolicyData)).to.be.false;
  });

  it("produces a 32-byte hex hash", async () => {
    expect(SigningPolicy.hash(signingPolicyData).length).to.equal(66);
  });

  it("lowercases all voter addresses in place", async () => {
    const signingPolicyData2 = {
      ...signingPolicyData,
      voters: signingPolicyData.voters.map((x) => x.toUpperCase()),
    };
    SigningPolicy.normalizeAddresses(signingPolicyData2);
    for (let i = 0; i < signingPolicyData.voters.length; i++) {
      expect(signingPolicyData2.voters[i]).to.equal(signingPolicyData.voters[i].toLowerCase());
    }
  });

  it("rejects encode when the signing policy is undefined", async () => {
    expect(() => SigningPolicy.encode(undefined as any)).to.throw("Signing policy is undefined");
  });

  it("rejects encode when voters array is missing", async () => {
    const signingPolicyData2 = { ...signingPolicyData, voters: undefined };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Invalid signing policy");
  });

  it("rejects encode when weights array is missing", async () => {
    const signingPolicyData2 = { ...signingPolicyData, weights: undefined };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Invalid signing policy");
  });

  it("rejects encode when voters and weights length disagree", async () => {
    const signingPolicyData2 = { ...signingPolicyData, weights: [...signingPolicyData.weights, 100] };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Invalid signing policy");
  });

  it("rejects encode when voter count exceeds the on-chain limit", async () => {
    const longArray = new Array(66000).fill("0x00");
    const signingPolicyData2 = { ...signingPolicyData, voters: longArray, weights: longArray as any };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Too many signers");
  });

  it("rejects encode when a voter address is malformed", async () => {
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

  it("rejects encode when a voter weight is out of range or non-integer", async () => {
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

  it("rejects encode when the random seed is malformed", async () => {
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

  it("rejects encode when the reward epoch id is out of range or non-integer", async () => {
    let signingPolicyData2 = { ...signingPolicyData, rewardEpochId: -3 };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Reward epoch id out of range");
    signingPolicyData2 = { ...signingPolicyData, rewardEpochId: 2 ** 25 };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Reward epoch id out of range");
    signingPolicyData2 = { ...signingPolicyData, rewardEpochId: 3.14 };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Reward epoch id out of range");
  });

  it("rejects encode when the starting voting round id is out of range or non-integer", async () => {
    let signingPolicyData2 = { ...signingPolicyData, startVotingRoundId: -3 };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Starting voting round id out of range");
    signingPolicyData2 = { ...signingPolicyData, startVotingRoundId: 2 ** 32 };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Starting voting round id out of range");
    signingPolicyData2 = { ...signingPolicyData, startVotingRoundId: 3.14 };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Starting voting round id out of range");
  });

  it("rejects encode when the threshold is out of range or non-integer", async () => {
    let signingPolicyData2 = { ...signingPolicyData, threshold: -3 };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Threshold out of range");
    signingPolicyData2 = { ...signingPolicyData, threshold: 2 ** 32 };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Threshold out of range");
    signingPolicyData2 = { ...signingPolicyData, threshold: 3.14 };
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Threshold out of range");
  });

  it("Should fail to hash empty 0x-prefixed signing policy", async () => {
    expect(() => SigningPolicy.hashEncoded("0x")).to.throw("Invalid signing policy");
  });

  it("Should fail to hash empty unprefixed signing policy", async () => {
    expect(() => SigningPolicy.hashEncoded("")).to.throw("shorter than");
  });

  it("Should fail to hash signing policy shorter than the fixed header", async () => {
    // 42 bytes (84 hex) is one byte short of the 43-byte header. The old "two 32-byte
    // chunks" heuristic accepted this (it splits into two chunks); the header check rejects it.
    expect(() => SigningPolicy.hashEncoded("0x" + "00".repeat(42))).to.throw("Invalid signing policy");
    expect(() => SigningPolicy.hashEncoded("0x" + "00".repeat(31))).to.throw("Invalid signing policy");
  });

  it("Should hash a valid encoded signing policy", async () => {
    const encoded = SigningPolicy.encode(signingPolicyData);
    const hash = SigningPolicy.hashEncoded(encoded);
    expect(hash.startsWith("0x")).to.be.true;
    expect(hash.length).to.equal(66);
  });
});
