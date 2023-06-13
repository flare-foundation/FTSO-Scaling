// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

interface IRewardManager {
    struct ClaimReward {
        bytes32[] merkleProof;
        uint256 amount;
        bytes4 quoteSymbol;
        address payable voterAddress;        
        uint64 chainId;
        bytes4 offerSymbol;
        address tokenContract;   // zero address for native token. Not currently used.
        uint64 epochId;
    }

    struct Offer {
        bytes4 quoteSymbol;
        bytes4 offerSymbol;
        uint32 weight;
    }

    function setVoting(address votingContract) external;
    function setVotingManager(address votingManagerContract) external;

    function claimReward(ClaimReward calldata _data) external;
    function offerReward(bytes /* Offer[] */ calldata offers) external payable;
}
