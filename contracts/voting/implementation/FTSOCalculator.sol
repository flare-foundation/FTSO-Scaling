// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "./Voting.sol";
import "./VotingManager.sol";
import "../../ftso/lib/FtsoMedian.sol";

// import "hardhat/console.sol";

contract FTSOCalculator {
    Voting public voting;

    constructor(Voting _voting) {
        voting = _voting;
    }

    function calculateMedian(
        uint256 _epochId,
        address[] calldata _voters,
        uint256[] calldata _prices,
        uint256 _elasticBandWidthPPM
    )
        public
        view
        returns (uint256[] memory index, FtsoMedian.Data memory data, uint256[] memory weights)
    {
        weights = new uint256[](_voters.length);
        for (uint256 i = 0; i < _voters.length; i++) {
            weights[i] = voting.getVoterWeightForEpoch(_voters[i], _epochId);
        }
        (index, data) = FtsoMedian._computeWeighted(
            _prices,
            weights,
            _elasticBandWidthPPM
        );
    }
}
