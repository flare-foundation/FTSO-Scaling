// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

struct RewardClaimWithProof {
    bytes32[] merkleProof;
    RewardClaim body;
}

struct RewardClaim {
    bool isFixedClaim;
    uint256 amount;
    address currencyAddress; // 0 for native currency
    address payable beneficiary;
    uint priceEpochId;
}

/**
 * Defines a reward offer in native coin or ERC20 token.
 */
struct Offer {
    uint256 amount; // amount of reward in native coin or ERC20 token
    address currencyAddress; // zero address for native currency or address of ERC20 token
    bytes4 offerSymbol; // offer symbol of the reward feed (4-byte encoded string with nulls on the right)
    bytes4 quoteSymbol; // quote symbol of the reward feed (4-byte encoded string with nulls on the right)
    address[] leadProviders; // list of lead providers 
    uint256 rewardBeltPPM; // reward belt in PPM (parts per million) in relation to the median price of the lead providers.
    uint256 elasticBandWidthPPM; // elastic band width in PPM (parts per million) in relation to the median price.
    uint256 iqrSharePPM; // Each offer defines IQR and PCT share in PPM (parts per million). The summ of all offers must be 1M.
    uint256 pctSharePPM;
    address remainderClaimer; // address that can claim undistributed part of the reward
}

struct FeePercentage {          // used for storing data provider fee percentage settings
    uint16 value;               // fee percentage value (value between 0 and 1e4)
    uint240 validFromEpoch;     // id of the reward epoch from which the value is valid
}

abstract contract IRewardManager {
    event RewardOffered(
        uint256 amount, // amount of reward in native coin or ERC20 token
        address currencyAddress, // zero address for native currency or address of ERC20 token
        bytes4 offerSymbol, // offer symbol of the reward feed (4-byte encoded string with nulls on the right)
        bytes4 quoteSymbol, // quote symbol of the reward feed (4-byte encoded string with nulls on the right)
        address[] leadProviders, // list of trusted providers
        uint256 rewardBeltPPM, // reward belt in PPM (parts per million) in relation to the median price of the trusted providers.
        uint256 elasticBandWidthPPM, // elastic band width in PPM (parts per million) in relation to the median price.
        uint256 iqrSharePPM, // Each offer defines IQR and PCT share in PPM (parts per million). The summ of all offers must be 1M.
        uint256 pctSharePPM,
        uint256 flrValue,
        address remainderClaimer  // address that can claim undistributed part of the reward
    );

    event FeePercentageChanged(
        address indexed dataProvider,
        uint256 value,
        uint256 validFromEpoch
    );

    function setVoting(address _votingContract) external virtual;

    function setVotingManager(address _votingManagerContract) external virtual;

    function setERC20PriceOracle(
        address _erc20PriceOracleContract
    ) external virtual;

    function claimReward(RewardClaimWithProof calldata _data, address _claimer) external virtual;

    function offerRewards(Offer[] calldata _offers) external payable virtual;

    // These functions are not for calling, but for exporting the type definitions in the metadata
    function rewardClaimDefinition(
        RewardClaim calldata _data
    ) external {}

    function offerDefinition(Offer calldata _data) external {}

    /**
     * @notice Allows data provider to set (or update last) fee percentage.
     * @param _feePercentageBIPS    number representing fee percentage in BIPS
     * @return _validFromEpoch      reward epoch number when the setting becomes effective.
     */
    function setDataProviderFeePercentage(uint256 _feePercentageBIPS)
        external virtual returns (uint256 _validFromEpoch);

    /**
     * @notice Returns the current fee percentage of `_dataProvider`
     * @param _dataProvider         address representing data provider
     */
    function getDataProviderCurrentFeePercentage(address _dataProvider)
        external view virtual returns (uint256 _feePercentageBIPS);

    function getDataProviderScheduledFeePercentageChanges(address _dataProvider)
        external view virtual returns (
            uint256[] memory _feePercentageBIPS,
            uint256[] memory _validFromEpoch,
            bool[] memory _fixed
        );

}

function hash(RewardClaimWithProof calldata _claim) pure returns (bytes32) {
    return keccak256(abi.encode(_claim.body));
}

using {hash} for RewardClaimWithProof global;
