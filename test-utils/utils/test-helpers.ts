import BN from "bn.js";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

export async function increaseTimeTo(tm: number) {
    let currentTime = await time.latest();
    if(tm <= currentTime) {
        console.log(`Already ahead of time, not increasing time: current ${currentTime}, requested ${tm}`);
    }
    try {
        await ethers.provider.send("evm_mine", [tm]);
    } catch (e) {
        // no need to handle this error
        //console.log(e);
    }
}

export function toBN(x: BN | number | string): BN {
    if (x instanceof BN) return x;
    // if (x instanceof BigNumber) return new BN(x.toHexString().slice(2), 16)
    return web3.utils.toBN(x);
}
