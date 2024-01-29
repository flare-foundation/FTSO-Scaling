import { expect } from "chai";
import { readFileSync } from "fs";
import Web3 from "web3";
import { ISigningPolicy, SigningPolicy } from "../../../../libs/fsp-utils/src/SigningPolicy";
import { defaultTestSigningPolicy } from "./coding-helpers";
import exp from "constants";

const web3 = new Web3("https://dummy");
describe.only(`SigningPolicy`, async () => {
  
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

  it("Should encode and decode signing policy", async () => {
    const encoded = SigningPolicy.encode(signingPolicyData);
    const decoded = SigningPolicy.decode(encoded);
    expect(decoded).to.deep.equal(signingPolicyData);
    const decoded2 = SigningPolicy.decode(encoded + "123456", false);
    expect(decoded2).to.deep.equal({...decoded, encodedLength: encoded.length - 2});
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
      voters: signingPolicyData.voters.map(x => x.toUpperCase())
    };
    SigningPolicy.normalizeAddresses(signingPolicyData2);
    for(let i = 0; i < signingPolicyData.voters.length; i++) {
      expect(signingPolicyData2.voters[i]).to.equal(signingPolicyData.voters[i].toLowerCase());
    }
  });

  it("Should fail to encode due to undefined signing policy", async () => {
    expect(() => SigningPolicy.encode(undefined as any)).to.throw("Signing policy is undefined");
  });

  it("Should fail to encode due to no voters", async () => {
    let signingPolicyData2 = {...signingPolicyData, voters: undefined};
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Invalid signing policy");
  });

  it("Should fail to encode due to no weights", async () => {
    let signingPolicyData2 = {...signingPolicyData, weights: undefined};
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Invalid signing policy");
  });

  it("Should fail to encode mismatch in voters and weights length", async () => {
    let signingPolicyData2 = {...signingPolicyData, weights: [...signingPolicyData.weights, 100]};
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Invalid signing policy");
  });

  it("Should fail to encode due to too many voters", async () => {
    let longArray = new Array(66000).fill("0x00")
    let signingPolicyData2 = {...signingPolicyData, voters: longArray, weights: longArray as any};
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Too many signers");
  });

  it("Should fail to encode due to invalid voter address", async () => {
    let signingPolicyData2 = {...signingPolicyData, weights: [...signingPolicyData.weights, 100], voters: [...signingPolicyData.voters, "0x00"]};
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Invalid signer address format");
    signingPolicyData2 = {...signingPolicyData, weights: [...signingPolicyData.weights, 100], voters: [...signingPolicyData.voters, "00"]};
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Invalid signer address format");
    signingPolicyData2 = {...signingPolicyData, weights: [...signingPolicyData.weights, 100], voters: [...signingPolicyData.voters, "00"]};
    expect(() => SigningPolicy.encode(signingPolicyData2)).to.throw("Invalid signer address format");

  });

  it("Should fail to encode due to invalid voter weight", async () => {
  });

  it("Should fail to encode due to invalid seed format", async () => {
  });

  it("Should fail to encode due to invalid random seed format", async () => {
  });

  it("Should fail to encode due to invalid startingVotingRound", async () => {
  });

  it("Should fail to encode due to threshold out of range", async () => {
  });

  it("Should fail to encode due to threshold out of range", async () => {
  });

});
