// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "../implementation/PriceOracle.sol";
import "../../userInterfaces/IERC20PriceOracle.sol";
import "../../userInterfaces/IPriceOracle.sol";

// import "hardhat/console.sol";

contract ERC20PriceOracle is IERC20PriceOracle, Governed {
    IPriceOracle priceOracle;

    mapping(address => bytes8)
        public currencyAddressToSymbol;

    constructor(address _governance) Governed(_governance) {}

    function setPriceOracle(IPriceOracle _priceOracle) public onlyGovernance {
        require(address(_priceOracle) != address(0), "zero address set oracle");
        priceOracle = _priceOracle;
    }

    function setERC20Settings(
        address erc20Address,
        bytes8 symbol
    ) public onlyGovernance {
        require(erc20Address != address(0), "zero address set settings");
        require(symbol != bytes8(0), "symbol must be non-zero");
        currencyAddressToSymbol[erc20Address] = symbol;
    }

    function getPrice(
        address currencyAddress
    ) public view returns (uint32 price, uint32 timestamp) {
        require(currencyAddress != address(0), "zero address get price");
        bytes8 symbol = currencyAddressToSymbol[currencyAddress];
        require(symbol != bytes8(0), "symbol not found");
        (price, timestamp) = priceOracle.lastAnchorPriceForSymbol(symbol);
    }
}
