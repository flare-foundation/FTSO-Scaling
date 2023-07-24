import { time } from "@nomicfoundation/hardhat-network-helpers";

export async function increaseTimeTo(timestampSec: number) {
  let currentTime = await time.latest();
  if (timestampSec <= currentTime) {
    console.log(`Already ahead of time, not increasing time: current ${currentTime}, requested ${timestampSec}`);
  }

  await time.increaseTo(timestampSec);
}