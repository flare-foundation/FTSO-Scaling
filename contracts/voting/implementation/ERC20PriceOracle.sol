// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "../implementation/PriceOracle.sol";
import "../../userInterfaces/IERC20PriceOracle.sol";
import "../../userInterfaces/IPriceOracle.sol";

contract ERC20PriceOracle is IERC20PriceOracle, Governed {
    IPriceOracle priceOracle;

    mapping(address => IERC20PriceOracle.ERC20Settings)
        public currencyAddressToSymbol;

    constructor(address _governance) Governed(_governance) {}

    function setPriceOracle(IPriceOracle _priceOracle) public onlyGovernance {
        require(address(_priceOracle) != address(0), "zero address set oracle");
        priceOracle = _priceOracle;
    }

    function setERC20Settings(
        address erc20Address,
        ERC20Settings calldata settings
    ) public onlyGovernance {
        require(erc20Address != address(0), "zero address set settings");
        require(settings.symbol != bytes8(0), "symbol not found");
        currencyAddressToSymbol[erc20Address] = settings;
    }

    function getPrice(
        address currencyAddress
    ) public view returns (uint32 price, uint32 timestamp) {
        require(currencyAddress != address(0), "zero address get price");
        bytes8 symbol = currencyAddressToSymbol[currencyAddress].symbol;
        require(symbol != bytes8(0), "symbol not found");
        // (price, timestamp) = priceOracle.lastAnchorPricesForSymbol(symbol);
        price = 100;
        timestamp = 0;
    }
}
