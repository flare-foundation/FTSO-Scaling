// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "../../userInterfaces/IVoterRegistry.sol";
import "./VotingManager.sol";

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
        uint256 indexed priceEpochId,
        bytes32 merkleRoot,
        uint256 timestamp
    );

    event MerkleRootConfirmationFailed(
        uint256 indexed priceEpochId,
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
        uint256 _priceEpochId,
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
        uint256 _priceEpochId,
        bytes32 _merkleRoot,
        Signature[] calldata signatures
    ) public {
        require(merkleRoots[_priceEpochId] == 0, "epochId already finalized");
        require(
            block.timestamp >=
                votingManager.firstSigningTimestampForEpoch(_priceEpochId),
            "signing too early"
        );
        require(
            block.timestamp <=
                votingManager.lastSigningTimestampForEpoch(_priceEpochId),
            "signing too late"
        );
        uint256 threshold = voterRegistry.thresholdForRewardEpoch(
            votingManager.getRewardEpochIdForEpoch(_priceEpochId)
        );
        uint256 weightSum = 0;
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = recoverSigner(_merkleRoot, signatures[i]);

            if (signer != address(0)) {
                uint256 weight = getVoterWeightForPriceEpoch(signer, _priceEpochId);
                weightSum += weight;                
                if (weightSum > threshold) {
                    merkleRoots[_priceEpochId] = _merkleRoot;
                    if (_priceEpochId >= votingManager.TOTAL_STORED_PROOFS()) {
                        merkleRoots[
                            _priceEpochId - votingManager.TOTAL_STORED_PROOFS()
                        ] = 0;
                    }
                    emit MerkleRootConfirmed(
                        _priceEpochId,
                        _merkleRoot,
                        block.timestamp
                    );
                    return;
                }
            }
        }
        emit MerkleRootConfirmationFailed(
            _priceEpochId,
            _merkleRoot,
            weightSum,
            threshold,
            block.timestamp
        );
        (_priceEpochId, _merkleRoot, block.timestamp);
    }

    // Returns the merkle root for a given epoch
    function getMerkleRoot(uint256 _priceRpochId) public view returns (bytes32) {
        bytes32 merkleRoot = merkleRoots[_priceRpochId];
        return merkleRoot;
    }

    // Returns the voter weight for a given epoch
    function getVoterWeightForPriceEpoch(
        address _voter,
        uint256 _priceEpochId
    ) public view returns (uint256) {
        return
            voterRegistry.getVoterWeightForRewardEpoch(
                _voter,
                votingManager.getRewardEpochIdForEpoch(_priceEpochId)
            );
    }

    function getDelegatorWeightForRewardEpoch(
        address _delegator,
        address _voter,
        uint256 _rewardEpochId
    ) public view returns (uint256) {
        return
            voterRegistry.getDelegatorWeightForRewardEpochAndVoter(
                _delegator,
                _voter,
                _rewardEpochId
            );
    }

    // Returns the voter weights for a given epoch
    function getVoterWeightsForEpoch(
        uint256 _priceEpochId,
        address[] calldata _voters
    ) public view returns (uint256[] memory) {
        uint256[] memory allWeights = new uint256[](_voters.length);
        for (uint256 i = 0; i < _voters.length; i++) {
            allWeights[i] = getVoterWeightForPriceEpoch(_voters[i], _priceEpochId);
        }
        return allWeights;
    }

    // Returns the current epoch id
    function getCurrentPriceEpochId() public view returns (uint256) {
        return votingManager.getCurrentPriceEpochId();
    }

    function firstSigningTimeForEpoch(
        uint256 _priceEpochId
    ) public view returns (uint256) {
        return votingManager.firstSigningTimestampForEpoch(_priceEpochId);
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
