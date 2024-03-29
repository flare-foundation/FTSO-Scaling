# FTSO scaling protocol

Flare Time Series Oracle (FTSO) Scaling protocol is the next generation of FTSO protocol (here referred to as FTSOv1). The first version of FTSO protocol was based on smart contracts. Data providers (participants in the FTSOv1 protocol, who were sending value feeds) were sending commit and reveal transactions every 3 mins. Since feed values were stored onto chain and smart contracts took care of calculation both of median prices and rewards, the gas usage in the protocol was significant. This limited the number of price feeds as well as frequency of updates. 

FTSO Scaling protocol was designed to address those shortcomings. In FTSO Scaling protocol blockchain is used for message synchronization and publishing of short proofs of prices obtained by consensus and proofs of reward claims.

All calculations (price medians, random numbers, reward claims) are done off-chain by data providers. The results are put in relevant Merkle trees, whose Merkle roots are signed by data providers and deposited on chain. The special [Relay](https://gitlab.com/flarenetwork/flare-smart-contracts-v2/-/blob/main/contracts/protocol/implementation/Relay.sol) contract is used for publishing 
Merkle roots, if sufficient weight of signatures is provided to it. 

The FTSO scaling protocol relies heavily on the Flare Systems Protocol. In particular it depends on signing policies that define data providers and signing weights, and on infrastructure for reward definition and claiming. The contracts that manage the Flare Systems Protocol are available [here](https://gitlab.com/flarenetwork/flare-smart-contracts-v2/-/blob/main/contracts/protocol/implementation).

Specific additional smart contracts to support specifics of FTSO protocol are available [here](https://gitlab.com/flarenetwork/flare-smart-contracts-v2/-/tree/main/contracts/ftso/implementation). These include contracts for receiving funds for rewarding, either from community or by system (inflation). In addition, there are contracts for price publishing and a registry of agreed decimals for encoding and publishing feed values, per each feed name.
