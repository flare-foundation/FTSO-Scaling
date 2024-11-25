export interface Delegator {
   // pChain address, like flare123l344hlugpg0r2ntdl6fn45qyp0f5m2xakc0r
   pAddress: string;
   // cChain address, like 0x4485B10aD3ff29066938922059c5CB1e5e8Ee8b6
   cAddress: string;
   // as string in GWei   
   amount: string;
   // as string in GWei
   delegatorRewardAmount: string;
}

export interface ValidatorInfo {
   // node id in form: NodeID-2a7BPY7UeJv2njMuyUHfBSTeQCYZj6bwV
   nodeId: string;
   // bonding address in form: flare1uz66xddzplexwfdsxrzxsnlwlucyfsuax00crd
   bondingAddress: string;
   // self bond in GWei
   selfBond: string;
   // ftso address in form "0xfe532cB6Fb3C47940aeA7BeAd4d61C5e041D950e",
   ftsoAddress: string; 
   // end of stake in unix time
   stakeEnd: number;
   // string of p-chain addresses (in form  flare1uz66xddzplexwfdsxrzxsnlwlucyfsuax00crd)
   pChainAddress: string[];
   // fee in GWei
   fee: number;
   // group number
   group: number;
   // is the validator eligible for staking rewards
   eligible: boolean;
   // data provider name
   ftsoName: string;
   // Boosting eligibility bond in GWei
   BEB: string;
   // Boost delegations in GWei
   boostDelegations: string;
   // boost in GWei
   boost: string;
   // self delegations in GWei
   selfDelegations: string;
   // other delegations in GWei
   normalDelegations: string;
   // total self bond in GWei
   totalSelfBond: string;
   // list of delegators
   delegators: Delegator[];
   // total stake amount in GWei“
   totalStakeAmount: string;
   // C-chain address in form of 0xaDEDCd23941E479b4736B38e271Eb926596BBe3d
   cChainAddress: string; 
   // overboost in GWei
   overboost: string;
   // reward weight in GWei
   rewardingWeight: string;
   // capped weight in GWei
   cappedWeight: string;
   // node reward amount in wei
   nodeRewardAmount: string;
   // validator reward amount in wei
   validatorRewardAmount: string;
}