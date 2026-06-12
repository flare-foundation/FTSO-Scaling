import Prando from "prando";
import { computeAddress, keccak256 } from "ethers";

/** Deterministic random. */
export const testRandom = new Prando(42);

export function generateRandomAddress(): string {
  const privateKeyHex = unsafeRandomHex(32);
  return computeAddress(privateKeyHex).toLowerCase();
}

export function randomHash() {
  return keccak256(unsafeRandomHex(40)).slice(2);
}

/** NOTE: Should only be used for tests. */
export function unsafeRandomHex(bytes: number): string {
  const randomBytes = new Uint8Array(bytes);
  for (let i = 0; i < randomBytes.length; i++) {
    randomBytes[i] = testRandom.nextInt(0, 255);
  }
  return "0x" + Buffer.from(randomBytes).toString("hex");
}
