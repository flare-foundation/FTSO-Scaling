// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

interface IPriceOracle {
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

    function publishPrices(
        uint32 _priceEpochId,
        bytes calldata _allPrices,
        bytes calldata _allSymbols,
        bytes32[] calldata _proof,
        uint256[] calldata _symbolsIndicesToPublish // must be ordered
    ) external;

    function anchorPricesForSymbol(bytes8 _symbol) external view returns (AnchorPrice memory);
    function lastAnchorPriceForSymbol(bytes8 _symbol) external view returns (uint32 price, uint32 timestamp);
}
