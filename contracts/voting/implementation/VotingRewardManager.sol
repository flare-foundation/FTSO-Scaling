// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "./../../governance/implementation/Governed.sol";
import "./VotingManager.sol";
import "./Voting.sol";
import "../../userInterfaces/IRewardManager.sol";
import "../../userInterfaces/IERC20PriceOracle.sol";
import "./types/StoredBalances.sol";

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract VotingRewardManager is Governed, IRewardManager { 
    using MerkleProof for bytes32[];
    uint256 constant internal MAX_BIPS = 1e4;

    VotingManager public votingManager;
    Voting public voting;
    IERC20PriceOracle public erc20PriceOracle;

    uint256 public minimalOfferValueWei; // in wei
    uint256 public priceExpirySeconds;

    // The set of (hashes of) claims that have _ever_ been processed successfully.
    mapping(bytes32 => bool) processedRewardClaims;

    uint256 currentRewardEpochId;

    uint256 public immutable feePercentageUpdateOffset; // fee percentage update timelock measured in reward epochs
    uint256 public immutable defaultFeePercentage; // default value for fee percentage
    mapping(address => FeePercentage[]) public dataProviderFeePercentages;

    mapping(uint256 => mapping(address => uint256)) public epochProviderUnclaimedRewardWeight;
    mapping(uint256 => mapping(address => uint256)) public epochProviderUnclaimedRewardAmount;    

    mapping(address => address) public authorizedClaimer;
    mapping(address => address) public authorizedRecepient;

    // The total remaining amount of rewards for the most recent reward epochs, from which claims are taken.
    uint constant STORED_PREVIOUS_BALANCES = 26;
    StoredBalances[STORED_PREVIOUS_BALANCES] storedRewardEpochBalances;
    uint256 nextRewardEpochBalanceIndex;

    function getNextRewardEpochBalance(
        address tokenAddress
    ) public view returns (uint balance) {
        balance = storedRewardEpochBalances[nextRewardEpochBalanceIndex]
            .totalRewardForTokenContract[tokenAddress];
    }

    function authorizeClaimer(address claimer) public {
        authorizedClaimer[msg.sender] = claimer;
    }

    function authorizeRecepient(address recepient) public {
        authorizedRecepient[msg.sender] = recepient;
    }

    // function getRemainingEpochBalance(
    //     address tokenAddress,
    //     uint epochId
    // ) public view returns (uint balance) {
    //     balance = storedRewardEpochBalances[
    //         rewardEpochIdAsStoredBalanceIndex(epochId)
    //     ].unclamedBalanceForTokenContract[tokenAddress];
    // }

    function rewardEpochIdAsStoredBalanceIndex(
        uint256 epochId
    ) internal view returns (uint256) {
        require(
            epochId + STORED_PREVIOUS_BALANCES >= currentRewardEpochId,
            "reward balance not preserved for epoch too far in the past"
        );
        // Have to add the modulus to get a nonnegative answer: -a % m == -(a % m)
        // return (nextRewardEpochBalanceIndex + epochId + STORED_PREVIOUS_BALANCES - currentRewardEpochId)
        //         % STORED_PREVIOUS_BALANCES;
        return epochId % STORED_PREVIOUS_BALANCES;
    }

    function setMinimalOfferParameters(
        uint256 _minimalOfferValueWei,
        uint256 _priceExpirySeconds
    ) public onlyGovernance {
        minimalOfferValueWei = _minimalOfferValueWei;
        priceExpirySeconds = _priceExpirySeconds;
    }

    // Bookkeeping semantics for anything that affects the reward balances.
    modifier maybePushRewardBalance() {
        uint256 _currentRewardEpochId = votingManager.getCurrentRewardEpochId();
        require(
            _currentRewardEpochId >= currentRewardEpochId,
            "(panic) epoch not monotonic"
        );
        if (_currentRewardEpochId > currentRewardEpochId) {
            currentRewardEpochId = _currentRewardEpochId;
            nextRewardEpochBalanceIndex = rewardEpochIdAsStoredBalanceIndex(
                currentRewardEpochId + 1
            );
            storedRewardEpochBalances[nextRewardEpochBalanceIndex].reset();
        }
        _;
    }

    constructor(
        address _governance,
        uint256 _feePercentageUpdateOffset,
        uint256 _defaultFeePercentage
    ) Governed(_governance) {
        require(_governance != address(0), "governance address is zero");
        feePercentageUpdateOffset = _feePercentageUpdateOffset;
        defaultFeePercentage = _defaultFeePercentage;
    }

    function setVoting(address _voting) public override onlyGovernance {
        require(address(voting) == address(0), "voting already initialized");
        voting = Voting(_voting);
    }

    function setVotingManager(
        address _votingManager
    ) public override onlyGovernance {
        require(
            address(votingManager) == address(0),
            "voting manager already initialized"
        );
        votingManager = VotingManager(_votingManager);
        // currentRewardEpochId = votingManager.getCurrentRewardEpochId();
        initialize();
    }

    function setERC20PriceOracle(
        address _erc20PriceOracle
    ) public override onlyGovernance {
        require(_erc20PriceOracle != address(0), "oracle address is zero");
        erc20PriceOracle = IERC20PriceOracle(_erc20PriceOracle);
    }

    function initialize() internal {
        currentRewardEpochId = votingManager.getCurrentRewardEpochId();
        nextRewardEpochBalanceIndex = rewardEpochIdAsStoredBalanceIndex(
            currentRewardEpochId + 1
        );
    }

    // This contract does not have any concept of symbols/price feeds and it is
    // entirely up to the clients to keep track of the total amount allocated to
    // them and determine the correct distribution of rewards to voters.
    // Ultimately, of course, only the actual amount of value stored for an
    // epoch's rewards can be claimed.
    //
    // TODO: support token currencies
    function offerRewards(
        Offer[] calldata offers
    ) public payable override maybePushRewardBalance {
        StoredBalances storage balances = storedRewardEpochBalances[
            nextRewardEpochBalanceIndex
        ];
        uint256 totalNativeOffer = 0;
        for (uint i = 0; i < offers.length; ++i) {
            Offer calldata offer = offers[i];
            uint256 offerValue;
            if (offer.currencyAddress == address(0)) {
                totalNativeOffer += offer.amount;
                offerValue = offer.amount;
            } else {
                uint256 price;
                uint256 timestamp;
                // Reverts if price is too old or not allowed
                (price, timestamp) = erc20PriceOracle.getPrice(
                    offer.currencyAddress
                );
                require(
                    block.timestamp - timestamp < priceExpirySeconds,
                    "price too old"
                );
                offerValue = price * offer.amount;
                require(
                    offerValue >= minimalOfferValueWei,
                    "offer value is too small"
                );
            }
            require(
                offer.iqrSharePPM + offer.pctSharePPM == 1000000,
                "iqrSharePPM + pctSharePPM != 1000000"
            );
            balances.credit(offer.currencyAddress, address(this), offer.amount);
            address remainderClaimer = offer.remainderClaimer;
            if(remainderClaimer == address(0)) {
                remainderClaimer = msg.sender;
            }
            emit RewardOffered(
                offer.amount,
                offer.currencyAddress,
                offer.offerSymbol,
                offer.quoteSymbol,
                offer.leadProviders,
                offer.rewardBeltPPM,
                offer.elasticBandWidthPPM,
                offer.iqrSharePPM,
                offer.pctSharePPM,
                offerValue,
                remainderClaimer
            );
        }
        require(
            totalNativeOffer >= msg.value,
            "native currency amount offered is less than value sent"
        );
    }

    function claimReward(
        ClaimReward calldata _data,
        address beneficiary
    ) public override maybePushRewardBalance {
        require(
            msg.sender == beneficiary || msg.sender == authorizedClaimer[beneficiary],
            "not authorized claimer"
        );
        
        ClaimRewardBody memory claim = _data.claimRewardBody;
        uint256 claimRewardEpoch = votingManager.getRewardEpochIdForEpoch(
            claim.epochId
        );
        require(
            claim.epochId ==
                votingManager.lastPriceEpochOfRewardEpoch(claimRewardEpoch),
            "claim epoch is not the last price epoch of the reward epoch"
        );
        require(
            claimRewardEpoch < currentRewardEpochId,
            "can only claim rewards for previous epochs"
        );
        uint256 previousRewardEpochBalanceIndex = rewardEpochIdAsStoredBalanceIndex(
                claimRewardEpoch
            );

        StoredBalances storage balances = storedRewardEpochBalances[
            previousRewardEpochBalanceIndex
        ];

        address addr = claim.currencyAddress;
        bytes32 claimHash = _data.hash();
        bytes32 claimHashRecord = keccak256(abi.encode(claimHash, beneficiary));

        require(
            !processedRewardClaims[claimHashRecord],
            "reward has already been claimed"
        );

        bytes32 rootForEpoch = voting.getMerkleRoot(claim.epochId);
        require(rootForEpoch != bytes32(0), "claim epoch not finalized yet, not merkle root available");

        require(
            _data.merkleProof.verify(
                rootForEpoch,
                claimHash
            ),
            "Merkle proof for reward failed"
        );

        uint256 feePercentage;
        // claim.weight > 0  --> data provider
        // claim.weight == 0 --> back claims
        if (claim.weight > 0 && balances.totalRewardForTokenContract[claim.voterAddress] == 0) {
            feePercentage = _getDataProviderFeePercentage(claim.voterAddress, claimRewardEpoch);
            balances.initializeForClaiming(claim.currencyAddress, claim.voterAddress, claim.weight, claim.amount, feePercentage);
        }

        uint256 claimWeight = voting.getDelegatorWeightForRewardEpoch(beneficiary, claim.voterAddress, claimRewardEpoch);
        feePercentage = beneficiary == claim.voterAddress ? _getDataProviderFeePercentage(claim.voterAddress, claimRewardEpoch) : 0;
        processedRewardClaims[claimHashRecord] = true;
        address payable recipient = authorizedRecepient[beneficiary] == address(0) ? payable(beneficiary) : payable(authorizedRecepient[beneficiary]);

        // claim.voterAddress == beneficiary  --> get fee
        // back claimer                       --> get back claim
        uint claimAmount = (claim.weight == 0 ? claim.amount : 0) + (feePercentage * claim.amount / 10000);
        balances.debit(addr, claim.voterAddress, recipient, claimWeight, claimAmount);
    }

    /**
     * @notice Allows data provider to set (or update last) fee percentage.
     * @param _feePercentageBIPS    number representing fee percentage in BIPS
     * @return Returns the reward epoch number when the setting becomes effective.
     */
    function setDataProviderFeePercentage(uint256 _feePercentageBIPS) external override returns (uint256) {
        require(_feePercentageBIPS <= MAX_BIPS, "fee percentage invalid");

        uint256 rewardEpoch = votingManager.getCurrentRewardEpochId() + feePercentageUpdateOffset;
        FeePercentage[] storage fps = dataProviderFeePercentages[msg.sender];

        // determine whether to update the last setting or add a new one
        uint256 position = fps.length;
        if (position > 0) {
            // do not allow updating the settings in the past
            // (this can only happen if the sharing percentage epoch offset is updated)
            require(rewardEpoch >= fps[position - 1].validFromEpoch, "fee percentage update failed");
            
            if (rewardEpoch == fps[position - 1].validFromEpoch) {
                // update
                position = position - 1;
            }
        }
        if (position == fps.length) {
            // add
            fps.push();
        }

        // apply setting
        fps[position].value = uint16(_feePercentageBIPS);
        assert(rewardEpoch < 2**240);
        fps[position].validFromEpoch = uint240(rewardEpoch);

        emit FeePercentageChanged(msg.sender, _feePercentageBIPS, rewardEpoch);
        return rewardEpoch;
    }


    /**
     * @notice Returns the current fee percentage of `_dataProvider`
     * @param _dataProvider         address representing data provider
     */
    function getDataProviderCurrentFeePercentage(address _dataProvider) external view override returns (uint256) {
        return _getDataProviderFeePercentage(_dataProvider, votingManager.getCurrentRewardEpochId());
    }

    /**
     * @notice Returns the scheduled fee percentage changes of `_dataProvider`
     * @param _dataProvider         address representing data provider
     * @return _feePercentageBIPS   positional array of fee percentages in BIPS
     * @return _validFromEpoch      positional array of block numbers the fee setings are effective from
     * @return _fixed               positional array of boolean values indicating if settings are subjected to change
     */
    function getDataProviderScheduledFeePercentageChanges(
        address _dataProvider
    )
        external view override
        returns (
            uint256[] memory _feePercentageBIPS,
            uint256[] memory _validFromEpoch,
            bool[] memory _fixed
        ) 
    {
        FeePercentage[] storage fps = dataProviderFeePercentages[_dataProvider];
        if (fps.length > 0) {
            uint256 currentEpoch = votingManager.getCurrentRewardEpochId();
            uint256 position = fps.length;
            while (position > 0 && fps[position - 1].validFromEpoch > currentEpoch) {
                position--;
            }
            uint256 count = fps.length - position;
            if (count > 0) {
                _feePercentageBIPS = new uint256[](count);
                _validFromEpoch = new uint256[](count);
                _fixed = new bool[](count);
                for (uint256 i = 0; i < count; i++) {
                    _feePercentageBIPS[i] = fps[i + position].value;
                    _validFromEpoch[i] = fps[i + position].validFromEpoch;
                    _fixed[i] = (_validFromEpoch[i] - currentEpoch) != feePercentageUpdateOffset;
                }
            }
        }        
    }
   
    /**
     * @notice Returns fee percentage setting for `_dataProvider` at `_rewardEpoch`.
     * @param _dataProvider         address representing a data provider
     * @param _rewardEpoch          reward epoch number
     */
    function _getDataProviderFeePercentage(
        address _dataProvider,
        uint256 _rewardEpoch
    )
        internal view
        returns (uint256)
    {
        FeePercentage[] storage fps = dataProviderFeePercentages[_dataProvider];
        uint256 index = fps.length;
        while (index > 0) {
            index--;
            if (_rewardEpoch >= fps[index].validFromEpoch) {
                return fps[index].value;
            }
        }
        return defaultFeePercentage;
    }

}
