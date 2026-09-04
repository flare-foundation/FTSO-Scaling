import { expect } from "chai";
import { ethers } from "ethers";
import { assertRandomProvesRoot } from "../../../libs/fsp-rewards/src/relay-acceptance";
import { FTSO2_PROTOCOL_ID } from "../../../libs/ftso-core/src/constants";
import { MerkleTreeStructs } from "../../../libs/ftso-core/src/data/MerkleTreeStructs";
import { IProtocolMessageMerkleRoot } from "../../../libs/ftso-core/src/fsp-utils/ProtocolMessageMerkleRoot";
import { IRelayMessage, RelayMessage } from "../../../libs/ftso-core/src/fsp-utils/RelayMessage";
import { MerkleTree } from "../../../libs/ftso-core/src/utils/MerkleTree";
import { getTestFile } from "../../utils/getTestFile";

// Relay v2 folds the calldata after the signatures into the signed merkle root and reverts unless it
// matches. Grace-period finalization rewards do not require a call to have succeeded on chain, so a
// finalization the Relay would have reverted must be rejected here or it takes a share of the offer
// from the finalizers that did the work.
describe(`Random number with proof (${getTestFile(__filename)})`, () => {
  const votingRoundId = 4111;

  // A round's tree the way the data provider builds it: the random leaf beside the feed leaves.
  function round(isSecure = true) {
    const random = { votingRoundId, value: "0x" + "7c".repeat(32), isSecure };
    const feeds = [1, 2, 3, 4].map((i) => ({
      votingRoundId,
      id: "0x" + i.toString(16).padStart(42, "0"),
      value: 1000 * i,
      turnoutBIPS: 10000,
      decimals: 2,
    }));
    const tree = new MerkleTree([
      MerkleTreeStructs.hashRandomResult(random),
      ...feeds.map((feed) => MerkleTreeStructs.hashFeedResult(feed)),
    ]);
    const proof = tree.getProof(MerkleTreeStructs.hashRandomResult(random));
    const message: IProtocolMessageMerkleRoot = {
      protocolId: FTSO2_PROTOCOL_ID,
      votingRoundId,
      isSecureRandom: isSecure,
      merkleRoot: tree.root,
    };
    return { random, message, proof };
  }

  const relayMessage = (message: IProtocolMessageMerkleRoot, randomNumber?: string, merkleProof?: string[]) =>
    ({
      signingPolicy: undefined,
      signatures: [],
      protocolMessageMerkleRoot: message,
      randomWithProof: randomNumber === undefined ? undefined : { randomNumber, merkleProof: merkleProof ?? [] },
    }) as unknown as IRelayMessage;

  it("accepts the random number and proof the data provider serves", () => {
    const { random, message, proof } = round();
    // a one-node proof would make the reordering case below vacuous
    expect(proof.length).to.be.greaterThan(1);
    expect(() => assertRandomProvesRoot(relayMessage(message, random.value, proof))).to.not.throw();
  });

  it("rejects a relay message with no protocol message to prove against", () => {
    // Only reachable if a caller stops filtering these out first; the compiler will not catch it, since
    // the project does not run with strictNullChecks.
    expect(() => assertRandomProvesRoot({ signatures: [] } as unknown as IRelayMessage)).to.throw(
      "no protocol message"
    );
  });

  it("rejects a finalization carrying no random number at all", () => {
    const { message } = round();
    expect(() => assertRandomProvesRoot(relayMessage(message))).to.throw(
      "Missing or misaligned random number and proof"
    );
  });

  it("rejects a random number that is not the one in the tree", () => {
    const { message, proof } = round();
    expect(() => assertRandomProvesRoot(relayMessage(message, "0x" + "01".repeat(32), proof))).to.throw(
      "does not prove against merkle root"
    );
  });

  it("rejects a truncated, reordered, or padded proof", () => {
    const { random, message, proof } = round();
    const mutations: [string, string[]][] = [
      ["truncated", proof.slice(1)],
      ["empty", []],
      ["reordered", [...proof].reverse()],
      ["one node too many", [...proof, "0x" + "ab".repeat(32)]],
    ];
    for (const [name, merkleProof] of mutations) {
      expect(() => assertRandomProvesRoot(relayMessage(message, random.value, merkleProof)), name).to.throw(
        "does not prove against merkle root"
      );
    }
  });

  // The leaf's round and secure flag come from the signed message, never from the calldata, so a
  // finalization cannot pair a valid-looking proof with a message it does not belong to.
  it("rejects a proof built for the other secure-random flag", () => {
    const secure = round(true);
    const insecure = round(false);
    expect(() => assertRandomProvesRoot(relayMessage(secure.message, insecure.random.value, insecure.proof))).to.throw(
      "does not prove against merkle root"
    );
  });

  // decode is what splits it out of the calldata, and the Relay reads it as whole 32-byte words.
  it("reads the random number and proof off the calldata only when it is word aligned", () => {
    const { random, message, proof } = round();
    const signingPolicy = {
      rewardEpochId: 1,
      startVotingRoundId: 1,
      threshold: 1,
      seed: "0x" + "11".repeat(32),
      voters: [ethers.Wallet.createRandom().address],
      weights: [65535],
    };
    const encoded = RelayMessage.encode({ signingPolicy, signatures: [], protocolMessageMerkleRoot: message });
    const encodedRandom = [random.value, ...proof].map((word) => word.slice(2)).join("");

    expect(RelayMessage.decode(encoded + encodedRandom).randomWithProof).to.deep.equal({
      randomNumber: random.value,
      merkleProof: proof,
    });
    expect(RelayMessage.decode(encoded).randomWithProof, "absent").to.be.undefined;
    expect(RelayMessage.decode(encoded + encodedRandom + "ab").randomWithProof, "misaligned").to.be.undefined;
    expect(RelayMessage.decode(encoded + random.value.slice(2, 40)).randomWithProof, "short word").to.be.undefined;
  });
});
