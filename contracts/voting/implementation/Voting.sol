// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "../../userInterfaces/IVoterRegistry.sol";
import "./VotingManager.sol";

import "hardhat/console.sol";

contract Voting {
    IVoterRegistry public voterRegistry;
    // VotingManager contract
    VotingManager public votingManager;

    // list of merkle roots, indexed by epochId
    mapping(uint256 => bytes32) public merkleRoots;

    struct Signature {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    // Emitted when a merkle root is confirmed
    event MerkleRootConfirmed(
        uint256 indexed epochId,
        bytes32 merkleRoot,
        uint256 timestamp
    );

    event MerkleRootConfirmationFailed(
        uint256 indexed epochId,
        bytes32 merkleRoot,
        uint256 weight,
        uint256 threshold,
        uint256 timestamp
    );

    constructor(IVoterRegistry _voterRegistry, VotingManager _votingManager) {
        voterRegistry = _voterRegistry;
        votingManager = _votingManager;
    }

    // Used to commit a hash. Only voters with a weight > 0 can commit.
    function commit(bytes32 _commitHash) public {}

    // Used to reveal voting data and/or bitvotes.
    function revealBitvote(
        bytes32 _random,
        bytes32 _merkleRoot,
        bytes calldata _bitVote,
        bytes calldata _prices
    ) public {}

    // Signs a merkle root and publishes the signature.
    function signResult(
        uint256 _epochId,
        bytes32 _merkleRoot,
        Signature calldata signature
    ) public {}

    // function hashForCommit(
    //     address _voter,
    //     uint256 _random,
    //     bytes32 _merkleRoot,
    //     bytes calldata _prices
    // ) public pure returns (bytes32) {
    //     return
    //         keccak256(
    //             abi.encodePacked(
    //                 abi.encode(_voter, _random, _merkleRoot, _prices)
    //             )
    //         );
    // }

    // function hashForPrices
    function finalize(
        uint256 _epochId,
        bytes32 _merkleRoot,
        Signature[] calldata signatures
    ) public {
        require(merkleRoots[_epochId] == 0, "epochId already finalized");
        require(
            block.timestamp >=
                votingManager.firstSigningTimestampForEpoch(_epochId),
            "signing too early"
        );
        require(
            block.timestamp <=
                votingManager.lastSigningTimestampForEpoch(_epochId),
            "signing too late"
        );
        uint256 threshold = voterRegistry.thresholdForRewardEpoch(
            votingManager.getRewardEpochIdForEpoch(_epochId)
        );
        uint256 weightSum = 0;
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = recoverSigner(_merkleRoot, signatures[i]);

            if (signer != address(0)) {
                uint256 weight = getVoterWeightForRewardEpoch(signer, _epochId);
                weightSum += weight;                
                if (weightSum > threshold) {
                    merkleRoots[_epochId] = _merkleRoot;
                    if (_epochId >= votingManager.TOTAL_STORED_PROOFS()) {
                        merkleRoots[
                            _epochId - votingManager.TOTAL_STORED_PROOFS()
                        ] = 0;
                    }
                    emit MerkleRootConfirmed(
                        _epochId,
                        _merkleRoot,
                        block.timestamp
                    );
                    return;
                }
            }
        }
        emit MerkleRootConfirmationFailed(
            _epochId,
            _merkleRoot,
            weightSum,
            threshold,
            block.timestamp
        );
        (_epochId, _merkleRoot, block.timestamp);
    }

    // Returns the merkle root for a given epoch
    function getMerkleRoot(uint256 _epochId) public view returns (bytes32) {
        return merkleRoots[_epochId];
    }

    // Returns the voter weight for a given epoch
    function getVoterWeightForRewardEpoch(
        address _voter,
        uint256 _epochId
    ) public view returns (uint256) {
        return
            voterRegistry.getVoterWeightForRewardEpoch(
                _voter,
                votingManager.getRewardEpochIdForEpoch(_epochId)
            );
    }

    // Returns the voter weights for a given epoch
    function getVoterWeightsForEpoch(
        uint256 _epochId,
        address[] calldata _voters
    ) public view returns (uint256[] memory) {
        uint256[] memory allWeights = new uint256[](_voters.length);
        for (uint256 i = 0; i < _voters.length; i++) {
            allWeights[i] = getVoterWeightForRewardEpoch(_voters[i], _epochId);
        }
        return allWeights;
    }

    // Returns the current epoch id
    function getCurrentPriceEpochId() public view returns (uint256) {
        return votingManager.getCurrentPriceEpochId();
    }

    function firstSigningTimeForEpoch(
        uint256 _epochId
    ) public view returns (uint256) {
        return votingManager.firstSigningTimestampForEpoch(_epochId);
    }

    function recoverSigner(
        bytes32 _hash,
        Signature memory signature
    ) public pure returns (address) {
        bytes memory prefix = "\x19Ethereum Signed Message:\n32";
        bytes32 prefixedHashMessage = keccak256(
            abi.encodePacked(prefix, _hash)
        );
        address signer = ecrecover(
            prefixedHashMessage,
            signature.v,
            signature.r,
            signature.s
        );
        return signer;
    }
}
