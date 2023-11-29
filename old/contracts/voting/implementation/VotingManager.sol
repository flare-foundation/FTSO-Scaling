// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "../../governance/implementation/Governed.sol";

contract VotingManager is Governed {
    uint256 public constant BUFFER_TIMESTAMP_OFFSET = 1636070400 seconds;
    uint256 public constant BUFFER_WINDOW = 45 seconds;
    uint256 public constant TOTAL_STORED_PROOFS = (5 weeks) / BUFFER_WINDOW;

    uint256 public firstRewardedPriceEpoch;
    uint256 public rewardEpochDurationInEpochs;
    uint256 public signingDurationSec;

    constructor(address _governance) Governed(_governance) {}

    function configureRewardEpoch(
        uint256 _firstRewardedEpoch,
        uint256 _rewardEpochDurationInEpochs
    ) public onlyGovernance {
        require(
            firstRewardedPriceEpoch == 0,
            "firstRewardedPriceEpoch already initialized"
        );
        require(
            rewardEpochDurationInEpochs == 0,
            "rewardEpochDurationInEpochs already initialized"
        );
        firstRewardedPriceEpoch = _firstRewardedEpoch;
        rewardEpochDurationInEpochs = _rewardEpochDurationInEpochs;
    }

    function configureSigningDuration(
        uint256 _signingDurationSec
    ) public onlyGovernance {
        signingDurationSec = _signingDurationSec;
    }

    function getCurrentPriceEpochId() public view returns (uint256) {
        require(block.timestamp >= BUFFER_TIMESTAMP_OFFSET, "Block timestamp too low");
        return (block.timestamp - BUFFER_TIMESTAMP_OFFSET) / BUFFER_WINDOW;
    }

    function getCurrentRewardEpochId() public view returns (uint256) {
        return
            (getCurrentPriceEpochId() - firstRewardedPriceEpoch) /
            rewardEpochDurationInEpochs;
    }

    function getRewardEpochIdForPriceEpoch(
        uint256 _priceEpochId
    ) public view returns (uint256) {
        require(_priceEpochId >= firstRewardedPriceEpoch, "epochId too low");
        require(
            rewardEpochDurationInEpochs > 0,
            "rewardEpochDurationInEpochs not initialized"
        );
        return (_priceEpochId - firstRewardedPriceEpoch) / rewardEpochDurationInEpochs;
    }

    function firstSigningTimestampForPriceEpoch(
        uint256 _priceEpochId
    ) public pure returns (uint256) {
        return
            BUFFER_TIMESTAMP_OFFSET +
            (_priceEpochId * BUFFER_WINDOW) +
            BUFFER_WINDOW /
            2 +
            1;
    }

    function lastSigningTimestampForPriceEpoch(
        uint256 _priceEpochId
    ) public view returns (uint256) {
        return firstSigningTimestampForPriceEpoch(_priceEpochId) + signingDurationSec - 1;
    }

    function lastPriceEpochOfRewardEpoch(
        uint256 _rewardEpochId
    ) public view returns (uint256) {
        return
            firstRewardedPriceEpoch + (_rewardEpochId + 1) * rewardEpochDurationInEpochs - 1;
    }
}
