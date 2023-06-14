// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "../../governance/implementation/Governed.sol";
import "./VotingManager.sol";
import "./Voting.sol";

contract PriceOracle is Governed {
    // VotingManager contract
    VotingManager public votingManager;

    Voting public voting;

    // multiple of 8 (one bytes32 = 8 x 4-byte prices)
    // rewardEpochId => numberOfFeeds
    mapping(uint256 => uint256) public numberOfFeedsPerRewardEpoch;

    // epochId => slotGroupId => symbol
    mapping(uint256 => mapping(uint256 => bytes32))
        public symbolsPerRewardEpoch;

    // rewardEpochId => slotId => slotOwner
    mapping(uint256 => mapping(uint256 => address))
        public slotOwnersPerRewardEpoch;

    // rewardEpochId => slotGroupId => slotBytes
    mapping(uint256 => mapping(uint256 => bytes32))
        public priceFeedsPerPriceEpoch;

    // epochId => timestamp
    mapping(uint256 => uint256) public publicationTimes;

    // events
    event PriceFeedPublished(
        uint256 indexed epochId,
        bytes4 indexed symbol,
        uint256 indexed slotId,
        uint32 price,
        uint256 timestamp
    );

    uint256 lastPublishedPriceEpochId;

    constructor(address _governance) Governed(_governance) {}

    function setVotingManager(
        VotingManager _votingManager
    ) public onlyGovernance {
        votingManager = _votingManager;
    }

    function setVoting(Voting _voting) public onlyGovernance {
        voting = _voting;
    }

    function setNumberOfFeedsForRewardEpoch(
        uint256 _rewardEpochId,
        uint256 _numberOfFeeds
    ) public onlyGovernance {
        require(
            votingManager.getCurrentRewardEpochId() < _rewardEpochId,
            "rewardEpochId too low"
        );
        require(_numberOfFeeds % 8 == 0, "numberOfFeeds must be multiple of 8");
        numberOfFeedsPerRewardEpoch[_rewardEpochId] = _numberOfFeeds;
    }

    function symbolForSlot(
        uint256 _slotId,
        uint256 _rewardEpochId
    ) public view returns (bytes4) {
        require(
            _slotId < numberOfFeedsPerRewardEpoch[_rewardEpochId],
            "slotId too high"
        );
        return
            bytes4(
                symbolsPerRewardEpoch[_rewardEpochId][_slotId / 8] <<
                    (32 * (_slotId % 8))
            );
    }

    function setSlotForRewardEpoch(
        uint256 _rewardEpochId,
        uint256 _slotId,
        address _slotOwner,
        bytes4 _symbol
    ) public onlyGovernance {
        require(
            votingManager.getCurrentRewardEpochId() < _rewardEpochId,
            "rewardEpochId too low"
        );
        require(
            _slotId < numberOfFeedsPerRewardEpoch[_rewardEpochId],
            "slotId too high"
        );
        slotOwnersPerRewardEpoch[_rewardEpochId][_slotId] = _slotOwner;
        bytes32 zeroMask = ~bytes32(
            uint256(0xffffffff) << (32 * (7 - (_slotId % 8)))
        );
        bytes32 symbolMask = bytes32(_symbol) >> (32 * (_slotId % 8));

        symbolsPerRewardEpoch[_rewardEpochId][_slotId / 8] =
            (symbolsPerRewardEpoch[_rewardEpochId][_slotId / 8] & zeroMask) |
            symbolMask;
    }

    function publishPrices(
        bytes32 dataMerkleRoot,
        bytes calldata _priceMessage
    ) public {
        require(_priceMessage.length >= 40, "invalid price message");
        uint256 epochId;
        uint256 rewardEpoch;
        assembly {
            epochId := shr(192, calldataload(100))
        }
        rewardEpoch = votingManager.getRewardEpochIdForEpoch(epochId);
        require(
            _priceMessage.length - 8 ==
                numberOfFeedsPerRewardEpoch[rewardEpoch] * 4,
            "invalid number of prices"
        );
        require(epochId > lastPublishedPriceEpochId, "epochId too low");

        bytes32 priceHash = keccak256(_priceMessage);
        bytes32 merkleRoot = dataMerkleRoot;
        if (merkleRoot < priceHash) {
            merkleRoot = keccak256(abi.encode(merkleRoot, priceHash));
        } else {
            merkleRoot = keccak256(abi.encode(priceHash, merkleRoot));
        }
        require(merkleRoot == voting.getMerkleRoot(epochId), "invalid data");
        for (uint256 i = 0; i < numberOfFeedsPerRewardEpoch[rewardEpoch] / 8; i++) {
            bytes32 pricesForSlot;
            assembly {
                pricesForSlot := calldataload(add(108, mul(32, i)))
            }
            priceFeedsPerPriceEpoch[epochId][i] = pricesForSlot;
            for (uint256 j = 0; j < 8; j++) {
                bytes4 symbol = bytes4(
                    symbolsPerRewardEpoch[rewardEpoch][i] << (32 * j)
                );
                bytes32 priceShift = pricesForSlot >> (32 * (7 - j));
                uint32 price;
                assembly {
                    price := priceShift
                }
                emit PriceFeedPublished(
                    epochId,
                    symbol,
                    (i * 8) + j,
                    price,
                    block.timestamp
                );
            }
        }
        publicationTimes[epochId] = block.timestamp;
        lastPublishedPriceEpochId = epochId;
    }
}
