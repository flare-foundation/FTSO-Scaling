import { time } from "@nomicfoundation/hardhat-network-helpers";

export async function increaseTimeTo(timestampSec: number) {
  const currentBlockTime = await time.latest();
  if (timestampSec <= currentBlockTime) {
    console.log(`Already ahead of time, not increasing time: current ${currentBlockTime}, requested ${timestampSec}`);
    return;
  }

  await time.increaseTo(timestampSec);
}