import { N } from "ethers";
import { ECDSASignatureWithIndex, IECDSASignatureWithIndex } from "./ECDSASignatureWithIndex";
import { IProtocolMessageMerkleRoot, ProtocolMessageMerkleRoot } from "./ProtocolMessageMerkleRoot";
import { ISigningPolicy, SigningPolicy } from "./SigningPolicy";

export interface IRelayMessage {
  signingPolicy: ISigningPolicy;
  protocolMessageMerkleRoot?: IProtocolMessageMerkleRoot;
  newSigningPolicy?: ISigningPolicy;
  signatures: IECDSASignatureWithIndex[];
  protocolMessageHash?: string;
  /**
   * The calldata after the last signature. Relay v2 requires it on the random number generating
   * protocol: the random number as one 32-byte word, then one word per Merkle proof node. Undefined
   * when the calldata carried none.
   */
  randomWithProof?: IRandomWithProof;
}

/** The random number and its Merkle proof, as they follow the signatures in relay() calldata. */
export interface IRandomWithProof {
  /** The random number, 0x-prefixed and 32 bytes — the leaf's value, verbatim from the calldata. */
  randomNumber: string;
  /** The proof nodes, each 0x-prefixed and 32 bytes; empty when the leaf is the root. */
  merkleProof: string[];
}

/**
 * Splits the calldata after the last signature into the random number and its proof nodes. The Relay
 * reads it as whole 32-byte words and reverts otherwise (`NoRandomNumber` when absent,
 * `IncorrectMerkleProof` when misaligned), so anything else is not a random number at all.
 */
function decodeRandomWithProof(encoded: string): IRandomWithProof | undefined {
  if (encoded.length === 0 || encoded.length % 64 !== 0) {
    return undefined;
  }
  const words: string[] = [];
  for (let position = 0; position < encoded.length; position += 64) {
    words.push("0x" + encoded.slice(position, position + 64));
  }
  return { randomNumber: words[0], merkleProof: words.slice(1) };
}

/** The largest `s` Relay v2 accepts: the lower half of the curve order (EIP-2), the bound behind `BadS`. */
const LOW_S_MAX = (N - 1n) / 2n;

export namespace RelayMessage {
  /**
   * Encodes relay message into 0x-prefixed hex string representing byte encoding.
   * If @param verify is true, the message is checked to be valid, throwing an error if not.
   * Validation includes:
   * - signing policy is present and valid
   * - signatures are present and valid (at least empty list)
   * - exactly one of protocol message merkle root or new signing policy is present
   * - protocol message merkle root or new signing policy is valid
   * - if new signing protocol is present, it is for the next reward epoch relative to signing policy
   * - signatures are valid according to signing policy
   * - signatures are in ascending order by index in signing policy and indices of signatures match indices in signing policy
   * - threshold is met
   * Only the signatures the Relay itself reads are checked: it stops at the threshold, so records declared
   * beyond that are neither validated nor counted against the size of the voter set.
   */
  export function encode(message: IRelayMessage, verify = false, chainId?: number): string {
    if (!message) {
      throw Error("Relay message is undefined");
    }
    if (!message.signingPolicy) {
      throw Error("Invalid relay message: no signing policy");
    }
    if (!message.signatures) {
      throw Error("Invalid relay message: no signatures. Must be at least empty array");
    }
    if (message.protocolMessageMerkleRoot && message.newSigningPolicy) {
      throw Error("Invalid relay message: protocol message merkle root and new signing policy are mutually exclusive");
    }
    if (!message.protocolMessageMerkleRoot && !message.newSigningPolicy) {
      throw Error("Invalid relay message: protocol message merkle root or new signing policy must be present");
    }
    let encoded = SigningPolicy.encode(message.signingPolicy);
    let hashToSign: string;
    if (message.protocolMessageMerkleRoot) {
      const encodedMessage = ProtocolMessageMerkleRoot.encode(message.protocolMessageMerkleRoot);
      encoded += encodedMessage.slice(2);
      if (verify) {
        hashToSign = ProtocolMessageMerkleRoot.hash(message.protocolMessageMerkleRoot, chainId);
      }
    } else {
      encoded += "00"; // protocolId == 0 indicates new signing policy
      const encodedNewSigningPolicy = SigningPolicy.encode(message.newSigningPolicy);
      encoded += encodedNewSigningPolicy.slice(2);
      if (verify) {
        hashToSign = SigningPolicy.hashEncoded(encodedNewSigningPolicy, chainId);
      }
    }
    let lastObservedIndex = -1;
    let totalWeight = 0;
    encoded += ECDSASignatureWithIndex.encodeSignatureList(message.signatures).slice(2);
    if (verify) {
      for (const signature of message.signatures) {
        if (signature.index >= message.signingPolicy.voters.length) {
          throw Error(`Invalid signature: index ${signature.index} is not a voter of the signing policy`);
        }
        if (signature.index <= lastObservedIndex) {
          throw Error(`Invalid signature: indices must be in ascending order`);
        }
        lastObservedIndex = signature.index;
        // Relay v2 rejects a non-canonical encoding before it recovers anything: BadV, then BadS.
        if (chainId !== undefined) {
          if (signature.v !== 27 && signature.v !== 28) {
            throw Error(`Invalid signature: v ${signature.v} is neither 27 nor 28`);
          }
          if (BigInt(signature.s) > LOW_S_MAX) {
            throw Error(`Invalid signature: s is above the lower half of the curve order`);
          }
        }
        const actualSigner = ECDSASignatureWithIndex.recoverSigner(hashToSign, signature);
        const signingPolicySigner = message.signingPolicy.voters[signature.index];
        if (actualSigner.toLowerCase() !== signingPolicySigner.toLowerCase()) {
          throw Error(`Invalid signature: signer ${actualSigner} does not match signing policy ${signingPolicySigner}`);
        }
        totalWeight += message.signingPolicy.weights[signature.index];
        // The Relay finalizes the moment the weight crosses and returns from inside its loop, so whatever
        // is declared after this signature is never looked at — only counted, to place the random trailer.
        if (totalWeight > message.signingPolicy.threshold) {
          break;
        }
      }
      if (totalWeight <= message.signingPolicy.threshold) {
        throw Error(`Invalid relay message: threshold not met`);
      }
    }
    return encoded;
  }

  /**
   * Decodes relay message from hex string (can be 0x-prefixed or not).
   */
  export function decode(encoded: string): IRelayMessage {
    const signingPolicy = SigningPolicy.decode(encoded, false);
    const encodedInternal = encoded.startsWith("0x") ? encoded.slice(2) : encoded;
    let newSigningPolicy: ISigningPolicy | undefined;
    let protocolMessageMerkleRoot: IProtocolMessageMerkleRoot | undefined;
    if (encodedInternal.length <= signingPolicy.encodedLength) {
      throw Error(`Invalid relay message: too short`);
    }
    const protocolId = encodedInternal.slice(signingPolicy.encodedLength, signingPolicy.encodedLength + 2);
    let encodedSignatures = "";
    if (protocolId === "00") {
      const rest = encodedInternal.slice(signingPolicy.encodedLength + 2);
      newSigningPolicy = SigningPolicy.decode(rest, false);
      if (rest.length <= newSigningPolicy.encodedLength) {
        throw Error(`Invalid relay message: too short - missing signatures`);
      }
      encodedSignatures = rest.slice(newSigningPolicy.encodedLength);
    } else {
      const rest = encodedInternal.slice(signingPolicy.encodedLength);
      protocolMessageMerkleRoot = ProtocolMessageMerkleRoot.decode(rest, false);
      encodedSignatures = rest.slice(protocolMessageMerkleRoot.encodedLength);
    }
    // Finalizations of the random number generating protocol on Relay v2 carry the random number and
    // its Merkle proof after the last signature. The signature list has to be sliced exactly or
    // decodeSignatureList rejects the input and the finalization is read as unparseable: 4 hex chars
    // of count, then 134 per 67-byte record. What follows is kept, because a call the Relay would
    // revert must not be graded as one it would have accepted.
    if (encodedSignatures.length < 4) {
      throw Error("Invalid relay message: missing signature count");
    }
    const signatureListLength = 4 + parseInt(encodedSignatures.slice(0, 4), 16) * 134;
    if (encodedSignatures.length < signatureListLength) {
      throw Error("Invalid relay message: signature list truncated");
    }
    const signatures = ECDSASignatureWithIndex.decodeSignatureList(encodedSignatures.slice(0, signatureListLength));
    return {
      signingPolicy,
      protocolMessageMerkleRoot,
      newSigningPolicy,
      signatures,
      randomWithProof: decodeRandomWithProof(encodedSignatures.slice(signatureListLength)),
    };
  }

  export function equals(a: IRelayMessage, b: IRelayMessage): boolean {
    if ((a.signingPolicy && !b.signingPolicy) || (!a.signingPolicy && b.signingPolicy)) {
      return false;
    }
    if (!SigningPolicy.equals(a.signingPolicy, b.signingPolicy)) {
      return false;
    }
    if (a.signatures.length !== b.signatures.length) {
      return false;
    }
    for (let i = 0; i < a.signatures.length; i++) {
      if (!ECDSASignatureWithIndex.equals(a.signatures[i], b.signatures[i])) {
        return false;
      }
    }

    if (
      (a.protocolMessageMerkleRoot && !b.protocolMessageMerkleRoot) ||
      (!a.protocolMessageMerkleRoot && b.protocolMessageMerkleRoot)
    ) {
      return false;
    }
    if ((a.newSigningPolicy && !b.newSigningPolicy) || (!a.newSigningPolicy && b.newSigningPolicy)) {
      return false;
    }
    if (a.newSigningPolicy && b.newSigningPolicy) {
      if (a.protocolMessageMerkleRoot || b.protocolMessageMerkleRoot) {
        return false;
      }
      return SigningPolicy.equals(a.newSigningPolicy, b.newSigningPolicy);
    }
    if (a.protocolMessageMerkleRoot && b.protocolMessageMerkleRoot) {
      if (a.newSigningPolicy || b.newSigningPolicy) {
        return false;
      }
      return ProtocolMessageMerkleRoot.equals(a.protocolMessageMerkleRoot, b.protocolMessageMerkleRoot);
    }
    // One of messages is invalid
    return false;
  }

  export function augment(m: IRelayMessage, chainId?: number): IRelayMessage {
    m.protocolMessageHash = ProtocolMessageMerkleRoot.hash(m.protocolMessageMerkleRoot, chainId);
    return m;
  }
}
