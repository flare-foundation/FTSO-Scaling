// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "../../governance/implementation/Governed.sol";
import "./VotingManager.sol";
import "./Voting.sol";

contract PriceOracle is Governed {
    // VotingManager contract
    VotingManager public votingManager;

    Voting public voting;

    mapping(bytes32 => AnchorPrice) public anchorPrices;

    struct AnchorPrice {
        uint32 price;
        uint32 timestamp;
        uint32 price1;
        uint32 timestamp1;
        uint32 price2;
        uint32 timestamp2;
        uint32 priceEpochId;
    }

    // events
    event PriceFeedPublished(
        uint256 indexed priceEpochId,
        bytes4 indexed offerSymbol,
        bytes4 indexed quoteSymbol,
        uint32 price,
        uint32 timestamp
    );

    constructor(address _governance) Governed(_governance) {}

    function setVotingManager(
        VotingManager _votingManager
    ) public onlyGovernance {
        votingManager = _votingManager;
    }

    function setVoting(Voting _voting) public onlyGovernance {
        voting = _voting;
    }

    function publishPrices(
        bytes32 _dataMerkleRoot, // one step Merkle proof
        uint32 _priceEpochId,
        bytes calldata _allPrices,
        bytes calldata _allSymbols,
        uint256[] calldata _symbolsIndicesToPublish // must be ordered
    ) public {
        // hash for prices includes (priceEpochId, allPrices, allSymbols)
        require(
            _allPrices.length * 2 == _allSymbols.length,
            "lengths do not match"
        );
        bytes32 priceHash = keccak256(
            bytes.concat(bytes4(_priceEpochId), _allPrices, _allSymbols)
        );

        bytes32 merkleRoot = _dataMerkleRoot;
        if (merkleRoot < priceHash) {
            merkleRoot = keccak256(abi.encode(merkleRoot, priceHash));
        } else {
            merkleRoot = keccak256(abi.encode(priceHash, merkleRoot));
        }
        require(
            merkleRoot == voting.getMerkleRoot(_priceEpochId),
            "invalid data"
        );
        for (uint256 i = 0; i < _symbolsIndicesToPublish.length; i++) {
            uint256 symbolIndex = _symbolsIndicesToPublish[i];
            bytes8 symbol = bytes8(_allSymbols[symbolIndex * 8]);
            uint32 price = uint32(bytes4(_allPrices[symbolIndex * 4]));

            if (
                publishAnchorPrice(
                    anchorPrices[symbol],
                    _priceEpochId,
                    price,
                    uint32(block.timestamp)
                )
            ) {
                emit PriceFeedPublished(
                    _priceEpochId,
                    bytes4(_allSymbols[symbolIndex * 8]),
                    bytes4(_allSymbols[symbolIndex * 8 + 4]),
                    price,
                    uint32(block.timestamp)
                );
            }
        }
    }

    function anchorPriceShift(AnchorPrice storage _anchorPrice) internal {
        _anchorPrice.price2 = _anchorPrice.price1;
        _anchorPrice.timestamp2 = _anchorPrice.timestamp1;
        _anchorPrice.price1 = _anchorPrice.price;
        _anchorPrice.timestamp1 = _anchorPrice.timestamp;
    }

    function publishAnchorPrice(
        AnchorPrice storage _anchorPrice,
        uint32 _priceEpochId,
        uint32 _price,
        uint32 _timestamp
    ) internal returns (bool) {
        uint32 currentPriceEpochId = _anchorPrice.priceEpochId;
        if (currentPriceEpochId >= _priceEpochId) {
            return false;
        }
        uint256 numberOfShifts = _priceEpochId - currentPriceEpochId;
        numberOfShifts = numberOfShifts > 2 ? 2 : numberOfShifts;
        while (numberOfShifts > 0) {
            anchorPriceShift(_anchorPrice);
            numberOfShifts--;
        }
        _anchorPrice.price = _price;
        _anchorPrice.timestamp = _timestamp;
        _anchorPrice.priceEpochId = _priceEpochId;
        return true;
    }
}
