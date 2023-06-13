import { VotingManagerInstance, VotingRewardManagerInstance } from "../../../typechain-truffle";
import { toBN } from "../../utils/test-helpers";
import { ClaimReward, MedianCalculationResult, VoterWithWeight } from "./voting-interfaces";


export interface PriceEpochRewardParameters {
  slotBitmask: string;
  baseSlotReward: BN;
  slotRewardReminder: BN;
}

export interface PoolInfo {
  owner: string;
  tokenContract: string;
}

export interface SlotRewardData {
  totalReward: BN;
  tokenContract: string;
}

export class RewardCalculatorForPriceEpoch {
  priceEpoch: number = 0;
  rewardEpoch!: BN;
  votingRewardManager!: VotingRewardManagerInstance;
  votingManager!: VotingManagerInstance;
  activePools: string[] = [];
  // slotId => poolId => reward
  slotRewardsPerPools: Map<number, Map<string, SlotRewardData>> = new Map<number, Map<string, SlotRewardData>>();
  // slotId => list of claims
  slotRewards: Map<number, ClaimReward[]> = new Map<number, ClaimReward[]>();
  maxRewardedSlotIndex: number = 0;

  constructor(
    priceEpoch: number,
    votingRewardManager: VotingRewardManagerInstance,
    votingManager: VotingManagerInstance
  ) {
    this.priceEpoch = priceEpoch;
    this.votingRewardManager = votingRewardManager;
    this.votingManager = votingManager;
  }

  // TODO: move rewarding configs initialization to RewardCalculator
  // Adapt to new idea of slot identification.
  async initialize() {
    this.rewardEpoch = await this.votingManager.getRewardEpochIdForEpoch(this.priceEpoch);
    this.activePools = await this.votingRewardManager.getActiveRewardPoolsForRewardEpoch(this.rewardEpoch);
    let poolRewardsPromises: any[] = [];
    let poolInfoPromises: any[] = [];

    for (let poolId of this.activePools) {
      poolRewardsPromises.push(this.votingRewardManager.rewardsInPriceEpoch(poolId, this.priceEpoch));
      poolInfoPromises.push(this.votingRewardManager.rewardPools(poolId));
    }

    let awaitedPromises = await Promise.all([...poolRewardsPromises, ...poolInfoPromises]);
    let poolRewardDataForActivePools = awaitedPromises.slice(0, this.activePools.length) as unknown as PriceEpochRewardParameters[];
    let poolInfoForActivePools = awaitedPromises.slice(this.activePools.length, this.activePools.length * 2) as unknown as PoolInfo[];

    for (let poolIndex = 0; poolIndex < this.activePools.length; poolIndex++) {
      let poolId = this.activePools[poolIndex];
      let poolRewardData = poolRewardDataForActivePools[poolIndex];
      let slotRewardReminder = poolRewardData.slotRewardReminder.toNumber();
      let index = 0;  // index of a slot
      let count = 0;  // sequential index of the rewarded slot in a given bitmask
      // processing each 4 bytes of hex string separately
      for (let hexHalfByte of poolRewardData.slotBitmask) {
        let halfByteToBits = parseInt(hexHalfByte, 16).toString(2).padStart(4, "0").split("");   // 4 bits in form ["0", "1", ..., "1"]
        for (let bit of halfByteToBits) {
          if (bit === "1") {
            let poolReward = this.slotRewardsPerPools.get(index) || new Map<string, SlotRewardData>();
            this.slotRewardsPerPools.set(index, poolReward);
            let slotReward = poolRewardData.baseSlotReward.add(toBN(count < slotRewardReminder ? 1 : 0));
            poolReward.set(poolId, {
              totalReward: slotReward,
              tokenContract: poolInfoForActivePools[poolIndex].tokenContract
            } as SlotRewardData
            );
            // this indicates the highest slot index to be rewarded by some active pool
            this.maxRewardedSlotIndex = Math.max(this.maxRewardedSlotIndex, index);
            count++;
          }
          index++;
        }
      }
    }
  }

  /**
   * Pseudo random selection based on the hash of (slotId, priceEpoch, voterAddress).
   * Used to get deterministic randomization for border cases of IQR belt. 
   * @param slotId 
   * @param priceEpoch 
   * @param voterAddress 
   * @returns 
   */
  randomSelect(slotId: number, priceEpoch: number, voterAddress: string) {
    return toBN(
      web3.utils.soliditySha3(
        web3.eth.abi.encodeParameters(
          ["uint256", "uint256", "address"],
          [slotId, priceEpoch, voterAddress]
        )
      )!
    ).mod(toBN(2)).eq(toBN(1));
  }

  /**
   * Given a slotId it calculates the claims for the slot from all active pools
   * @param slotId 
   * @param calculationResult 
   * @param iqrShare 
   * @param pctShare 
   * @returns 
   */
  calculateClaimsForSlot(slotId: number, calculationResult: MedianCalculationResult, iqrShare: BN, pctShare: BN): ClaimReward[] {
    // randomization for border cases
    // - a random for IQR belt is calculated from hash(priceEpochId, slotId, address)
    let voterRecords: VoterWithWeight[] = [];
    let lowIQR = parseInt(calculationResult.data.quartile1Price);
    let highIQR = parseInt(calculationResult.data.quartile3Price);
    let lowPCT = parseInt(calculationResult.data.lowElasticBandPrice);
    let highPCT = parseInt(calculationResult.data.highElasticBandPrice);

    for (let i = 0; i < calculationResult.voters!.length; i++) {
      let voter = calculationResult.voters![i];
      let weight = calculationResult.weights![i];
      let price = calculationResult.prices![i];
      voterRecords.push({
        voterAddress: voter,
        weight: weight,
        iqr: (price > lowIQR && price < highIQR) || ((price === lowIQR || price === highIQR) && this.randomSelect(slotId, this.priceEpoch, voter)),
        pct: price > lowPCT && price < highPCT
      });
    }
    // Sort by voters' addresses
    voterRecords.sort((a, b) => {
      if (a.voterAddress < b.voterAddress) {
        return -1;
      } else if (a.voterAddress > b.voterAddress) {
        return 1;
      }
      return 0;
    });

    let iqrSum: BN = toBN(0);
    let pctSum: BN = toBN(0);
    for (let voterRecord of voterRecords) {
      if (voterRecord.iqr) {
        iqrSum = iqrSum.add(voterRecord.weight);
      }
      if (voterRecord.pct) {
        pctSum = pctSum.add(voterRecord.weight);
      }
    }
    let totalRewardedWeight = toBN(0);
    for (let voterRecord of voterRecords) {
      let newWeight = toBN(0);
      if (voterRecord.iqr) {
        newWeight = newWeight.add(iqrShare.mul(voterRecord.weight).mul(pctSum));
      }
      if (voterRecord.pct) {
        newWeight = newWeight.add(pctShare.mul(voterRecord.weight).mul(iqrSum));
      }
      voterRecord.weight = newWeight;
      totalRewardedWeight = totalRewardedWeight.add(newWeight);
    }
    // calculate claims for the slot from all pools
    let slotRewards = this.slotRewardsPerPools.get(slotId);
    if (!slotRewards) {
      return [];
    }
    let rewardClaims: ClaimReward[] = [];

    for (let poolId of slotRewards.keys()) {
      let poolReward = slotRewards.get(poolId)!;
      for (let voterRecord of voterRecords) {
        let reward = voterRecord.weight.mul(poolReward.totalReward).div(totalRewardedWeight);
        let claimReward = {
          merkleProof: [],
          chainId: 0,
          epochId: this.priceEpoch,
          voterAddress: voterRecord.voterAddress,
          poolId: poolId,
          amount: reward,
          tokenContract: poolReward.tokenContract
        } as ClaimReward;
        rewardClaims.push(claimReward);
      }
    }
    return rewardClaims;
  }

  /**
   * Merges new claims with previous claims where previous claims are the cumulative 
   * claims for all previous price epochs withing the same reward epoch.
   * Merging is done by the key (address, poolId).
   * This function can be used to accumulate claims for all slots in the same reward epoch 
   * as well as to accumulate claims for all price epochs in the same reward epoch.
   * @param previousClaims 
   * @param newClaims 
   * @returns 
   */
  mergeClaims(previousClaims: ClaimReward[], newClaims: ClaimReward[]): ClaimReward[] {
    // address => poolId => ClaimReward
    let claimsMap = new Map<string, Map<string, ClaimReward>>();
    // init map from previous claims
    for (let claim of previousClaims) {
      let voterClaims = claimsMap.get(claim.voterAddress) || new Map<string, ClaimReward>();
      claimsMap.set(claim.voterAddress, voterClaims);
      if (voterClaims.has(claim.poolId)) {
        throw new Error("Duplicate claim for the same pool and voter");
      }
      voterClaims.set(claim.poolId, claim);
    }
    // merge with new claims by adding amounts
    for (let claim of newClaims) {
      let voterClaims = claimsMap.get(claim.voterAddress) || new Map<string, ClaimReward>();
      claimsMap.set(claim.voterAddress, voterClaims);
      let previousClaim = voterClaims.get(claim.poolId);
      if (previousClaim) {
        previousClaim.amount = previousClaim.amount.add(claim.amount);
      } else {
        voterClaims.set(claim.poolId, claim);
      }
    }
    // unpacking the merged map to a list of claims
    let mergedClaims: ClaimReward[] = [];
    for (let voterClaims of claimsMap.values()) {
      for (let claim of voterClaims.values()) {
        mergedClaims.push(claim);
      }
    }
    return mergedClaims;
  }

  /**
   * Calculates claims for all slots in the price epoch.
   * @param calculationResults 
   * @param iqrShare 
   * @param pctShare 
   * @returns 
   */
  claimsForSlots(calculationResults: MedianCalculationResult[], iqrShare: BN, pctShare: BN): ClaimReward[] {
    let claims: ClaimReward[] = [];
    for (let [slotId, calculationResult] of calculationResults.entries()) {
      claims = this.mergeClaims(claims, this.calculateClaimsForSlot(slotId, calculationResult, iqrShare, pctShare));
    }
    return claims;
  }

}
