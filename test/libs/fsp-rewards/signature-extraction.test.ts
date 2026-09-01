import { expect } from "chai";
import { Wallet } from "ethers";
import { DataManagerForRewarding } from "../../../libs/fsp-rewards/src/DataManagerForRewarding";
import { SubmissionData } from "../../../libs/ftso-core/src/IndexerClient";
import { RewardEpoch } from "../../../libs/ftso-core/src/RewardEpoch";
import { CHAIN_ID, FTSO2_PROTOCOL_ID } from "../../../libs/ftso-core/src/constants";
import { ECDSASignature } from "../../../libs/ftso-core/src/fsp-utils/ECDSASignature";
import {
  IProtocolMessageMerkleRoot,
  ProtocolMessageMerkleRoot,
} from "../../../libs/ftso-core/src/fsp-utils/ProtocolMessageMerkleRoot";
import { SignaturePayload } from "../../../libs/ftso-core/src/fsp-utils/SignaturePayload";
import { emptyLogger } from "../../../libs/ftso-core/src/utils/ILogger";
import { getTestFile } from "../../utils/getTestFile";
import { generateAddress } from "../../utils/generators";

// Without a finalization to name a consensus hash, signatures are keyed by the digest of the message each
// one signed, and that digest is the reward epoch's. Reading a source bound epoch as a legacy one recovers
// addresses no signing policy holds, so the round comes back with no signatures at all - and the round's
// double signing penalties are charged off this same map, finalized or not.
describe(`Signature extraction without a consensus hash (${getTestFile(__filename)})`, () => {
  const votingRoundId = 4333;
  const privateKey = "0x" + "42".repeat(32);
  const signerAddress = new Wallet(privateKey).address.toLowerCase();
  const submitAddress = generateAddress("submit-signatures");

  const message: IProtocolMessageMerkleRoot = {
    protocolId: FTSO2_PROTOCOL_ID,
    votingRoundId,
    isSecureRandom: true,
    merkleRoot: "0x" + "55".repeat(32),
  };

  // Only the lookups extractSignatures makes, plus the digest under test.
  const rewardEpochOn = (sourceChainId: number | undefined) =>
    ({
      sourceChainId,
      getSigningAddressFromSubmitSignatureAddress: (address: string) =>
        address === submitAddress.toLowerCase() ? signerAddress : undefined,
      isEligibleSignerAddress: (address: string) => address === signerAddress,
      signerToSigningWeight: () => 1,
      signerToVotingPolicyIndex: () => 0,
    }) as unknown as RewardEpoch;

  function submissionSignedUnder(sourceChainId: number | undefined): SubmissionData[] {
    const payload = SignaturePayload.encode({
      type: "0x00",
      message,
      signature: ECDSASignature.signMessageHash(ProtocolMessageMerkleRoot.hash(message, sourceChainId), privateKey),
      unsignedMessage: "0x",
    });
    return [
      {
        submitAddress,
        relativeTimestamp: 1,
        votingEpochIdFromTimestamp: votingRoundId + 1,
        timestamp: 1,
        blockNumber: 1,
        transactionIndex: 0,
        messages: [{ protocolId: FTSO2_PROTOCOL_ID, votingRoundId, payload }],
      } as unknown as SubmissionData,
    ];
  }

  const extract = (rewardEpoch: RewardEpoch, submissions: SubmissionData[]) =>
    DataManagerForRewarding.extractSignatures(
      votingRoundId,
      rewardEpoch,
      submissions,
      FTSO2_PROTOCOL_ID,
      undefined,
      emptyLogger
    );

  it("keys a legacy epoch's signatures by the bare digest", () => {
    const signatures = extract(rewardEpochOn(undefined), submissionSignedUnder(undefined));
    expect([...signatures.keys()]).to.deep.equal([ProtocolMessageMerkleRoot.hash(message)]);
    expect(signatures.get(ProtocolMessageMerkleRoot.hash(message))).to.have.length(1);
  });

  it("keys a source bound epoch's signatures by the chain bound digest", () => {
    const signatures = extract(rewardEpochOn(CHAIN_ID()), submissionSignedUnder(CHAIN_ID()));
    expect([...signatures.keys()]).to.deep.equal([ProtocolMessageMerkleRoot.hash(message, CHAIN_ID())]);
  });

  it("recovers nothing when the epoch's digest is not the one the voter signed", () => {
    expect(extract(rewardEpochOn(undefined), submissionSignedUnder(CHAIN_ID())).size).to.equal(0);
    expect(extract(rewardEpochOn(CHAIN_ID()), submissionSignedUnder(undefined)).size).to.equal(0);
  });
});
