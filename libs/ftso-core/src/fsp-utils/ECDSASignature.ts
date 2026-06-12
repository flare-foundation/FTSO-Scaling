import { getBytes, hashMessage, recoverAddress, Signature, SigningKey } from "ethers";
export interface IECDSASignature {
  r: string;
  s: string;
  v: number;
}

export namespace ECDSASignature {
  /**
   * Encodes ECDSA signature into 0x-prefixed hex string representing byte encoding
   */
  export function encode(signature: IECDSASignature): string {
    return "0x" + signature.v.toString(16).padStart(2, "0") + signature.r.slice(2) + signature.s.slice(2);
  }

  /**
   * Decodes ECDSA signature with index from hex string (can be 0x-prefixed or not).
   */
  export function decode(encodedSignature: string): IECDSASignature {
    const encodedSignatureInternal = (
      encodedSignature.startsWith("0x") ? encodedSignature.slice(2) : encodedSignature
    ).toLowerCase();
    if (!/^[0-9a-f]*$/.test(encodedSignatureInternal)) {
      throw Error(`Invalid format - not hex string: ${encodedSignature}`);
    }
    if (encodedSignatureInternal.length !== 130) {
      // (1 + 32 + 32) * 2 = 134
      throw Error(`Invalid encoded signature length: ${encodedSignatureInternal.length}`);
    }
    const v = parseInt(encodedSignatureInternal.slice(0, 2), 16);
    const r = "0x" + encodedSignatureInternal.slice(2, 66);
    const s = "0x" + encodedSignatureInternal.slice(66, 130);
    return {
      v,
      r,
      s,
    };
  }

  /**
   * Signs message hash with ECDSA using private key
   */
  export function signMessageHash(messageHash: string, privateKey: string): IECDSASignature {
    if (!/^0x[0-9a-f]{64}$/i.test(messageHash)) {
      throw Error(`Invalid message hash format: ${messageHash}`);
    }
    const signatureObject = new SigningKey(privateKey).sign(hashMessage(getBytes(messageHash)));
    return {
      v: signatureObject.v,
      r: signatureObject.r,
      s: signatureObject.s,
    } as IECDSASignature;
  }

  /**
   * Recovers signer address from message hash and signature
   */
  export function recoverSigner(messageHash: string, signature: IECDSASignature): string {
    return recoverAddress(
      hashMessage(getBytes(messageHash)),
      Signature.from({ r: signature.r, s: signature.s, v: signature.v })
    ).toLowerCase();
  }
}
