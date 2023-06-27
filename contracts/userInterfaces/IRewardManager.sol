// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

struct ClaimReward {
    bytes32[] merkleProof;
    ClaimRewardBody claimRewardBody;
}

struct ClaimRewardBody {
    uint256 amount;
    address currencyAddress; // 0 for native currency
    address payable voterAddress;        
    uint epochId;
}

/*
 * TODO: Additional mechanism: include list of "lead providers" and "bandwidth", so that this offer
 * is only distributed if the prices from these lead providers have a spread (percentage or maybe absolute value?)
 * less than the bandwidth.  This means that each offer is treated as its own "pool" and the set of all offers
 * doesn't aggregate.  Aggregation does happen when ClaimRewards are computed, though (in the client).
 */
struct Offer {
    uint256 amount;
    address currencyAddress; // 0 for native currency
    bytes4 quoteSymbol;
    bytes4 offerSymbol;
    address[] trustedProviders; // list of trusted providers
    uint256 rewardBeltPPM;  // reward belt in PPM (parts per million) in relation to the median price of the trusted providers.
    uint256 flrValue;
}

abstract contract IRewardManager {
    function setVoting(address votingContract) external virtual;
    function setVotingManager(address votingManagerContract) external virtual;

    function claimReward(ClaimReward calldata _data) external virtual;
    function offerRewards(Offer[] calldata offers) external payable virtual;

    // These functions are not for calling, but for exporting the type definitions in the metadata
    function claimRewardBodyDefinition(ClaimRewardBody calldata _data) external {}
    function offerDefinition(Offer calldata _data) external {}
}

function hash(ClaimReward calldata claim) pure returns (bytes32) {
    return keccak256(abi.encode(claim.claimRewardBody));
}

using { hash } for ClaimReward global;