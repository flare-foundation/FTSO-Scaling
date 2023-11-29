// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "../../governance/implementation/Governed.sol";
import "./VotingManager.sol";
import "./Voting.sol";
import "../../userInterfaces/IPriceOracle.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "hardhat/console.sol";

contract PriceOracle is Governed, IPriceOracle {
    using MerkleProof for bytes32[];

    Voting public voting;
    mapping(bytes32 => AnchorPrice) public anchorPrices;

    constructor(address _governance) Governed(_governance) {}

    function setVoting(Voting _voting) public onlyGovernance {
        voting = _voting;
    }

    function publishPrices(
        uint32 _priceEpochId,
        bytes calldata _allPrices,
        bytes calldata _allSymbols,
        bytes32[] calldata _priceProof,
        uint256[] calldata _symbolsIndicesToPublish // must be ordered
    ) public {
        require(
            _allPrices.length * 2 == _allSymbols.length,
            "lengths do not match"
        );
        {
            bytes32 bulkPriceHash = keccak256(
                bytes.concat(bytes4(_priceEpochId), _allPrices, _allSymbols)
            );
            bytes32 epochMerkleRoot = voting.getMerkleRootForPriceEpoch(_priceEpochId);
            require(
                _priceProof.verify(epochMerkleRoot, bulkPriceHash),
                "invalid merkle root"
            );
        }

        for (uint256 i = 0; i < _symbolsIndicesToPublish.length; i++) {
            uint256 symbolIndex = _symbolsIndicesToPublish[i];
            bytes8 symbol = bytes8(_allSymbols[symbolIndex * 8: symbolIndex * 8 + 8]);
            uint32 price = uint32(bytes4(_allPrices[symbolIndex * 4: symbolIndex * 4 + 4]));
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
                    bytes4(_allSymbols[symbolIndex * 8: symbolIndex * 8 + 4]),
                    bytes4(_allSymbols[symbolIndex * 8 + 4: symbolIndex * 8 + 8]),
                    price,
                    uint32(block.timestamp)
                );
            }
        }
    }

    function anchorPricesForSymbol(bytes8 _symbol) public view returns (AnchorPrice memory){
        return anchorPrices[_symbol];
    }

    function lastAnchorPriceForSymbol(bytes8 _symbol) public view returns (uint32 price, uint32 timestamp){
        price = anchorPrices[_symbol].price;
        timestamp = anchorPrices[_symbol].timestamp;
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
