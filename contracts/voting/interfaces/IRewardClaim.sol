// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

interface IRewardClaim {
    struct ClaimReward {
        bytes32[] merkleProof;
        uint256 amount;
        bytes4 symbol;
        address payable voterAddress;        
        uint64 chainId;
        address tokenContract;   // zero address for native token. Not currently used.
        uint64 epochId;
    }

    function verifyClaimReward(ClaimReward calldata _data) external view returns (bool _proved);
}
