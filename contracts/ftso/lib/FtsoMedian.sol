// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

library FtsoMedian {
    
    struct Data {                       // used for storing the results of weighted median calculation
        uint256 medianIndex;            // index of the median price
        uint256 quartile1Index;         // index of the first price corresponding to the first quartile price
        uint256 quartile3Index;         // index of the last price corresponding to the third quartil price        
        uint256 leftSum;                // auxiliary sum of weights left from the median price
        uint256 rightSum;               // auxiliary sum of weights right from the median price
        uint256 medianWeight;           // weight of the median price
        uint256 lowWeightSum;           // sum of weights corresponding to the prices too low for reward
        uint256 rewardedWeightSum;      // sum of weights corresponding to the prices eligible for reward
        uint256 highWeightSum;          // sum of weights corresponding to the prices too high for reward
        uint256 finalMedianPrice;       // median price
        uint256 quartile1Price;         // first quartile price
        uint256 quartile3Price;         // third quartile price
        uint256 lowElasticBandPrice;    // price between lowElasticBandPrice and median price is rewarded
        uint256 highElasticBandPrice;   // price between median price and highElasticBandPrice is rewarded
    }

    struct QSVariables {                // used for storing variables in quick select algorithm
        uint256 leftSum;                // sum of values left to the current position
        uint256 rightSum;               // sum of values right to the current position
        uint256 newLeftSum;             // updated sum of values left to the current position
        uint256 newRightSum;            // updated sum of values right to the current position
        uint256 pivotWeight;            // weight associated with the pivot index
        uint256 leftMedianWeight;       // sum of weights left to the median
        uint256 rightMedianWeight;      // sum of weights right to the median
    }

    struct QSPositions {                // used for storing positions in quick select algorithm
        uint256 pos;                    // position index
        uint256 left;                   // index left to the position index
        uint256 right;                  // index right to the position index
        uint256 pivotId;                // pivot index
    }

    /**
     * @notice Computes the weighted median price and accompanying data
     * @param _price                positional array of prices
     * @param _weight               positional array of weights
     * @return _index               permutation of indices of the input arrays that determines the sorting of _price
     * @return _d                   struct storing the weighted median price and accompanying data
     */
    function _computeWeighted(
        uint256[] memory _price,
        uint256[] memory _weight,
        uint256 _elasticBandWidthPPM
    ) 
        internal view 
        returns (
            uint256[] memory _index,
            Data memory _d
        )
    {
        uint256 count = _price.length;

        // initial index state
        _index = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            _index[i] = i;
        }

        // quick select algorithm to find the weighted median
        (_d.medianIndex, _d.leftSum, _d.rightSum) = _quickSelect(
            2,
            0,
            count - 1,
            0,
            0,
            _index,
            _price,
            _weight
        );
        _d.medianWeight = _weight[_index[_d.medianIndex]];
        uint256 totalSum = _d.medianWeight + _d.leftSum + _d.rightSum;

        // procedure to find the first quartile bound
        if (_d.medianIndex == 0) {
            // first quartile index is 0
            (_d.quartile1Index, _d.lowWeightSum, ) = (_d.medianIndex, 0, _d.rightSum);
        } else if (_d.leftSum <= totalSum / 4) { 
            // left sum for median is below the first quartile threshold
            (_d.quartile1Index, _d.lowWeightSum, ) = (_d.medianIndex, _d.leftSum, _d.rightSum);
        } else {
            // quick select algorithm to find the first quartile bound (without moving the median index)
            (_d.quartile1Index, _d.lowWeightSum, ) = _quickSelect(
                1,
                0,
                _d.medianIndex - 1,
                0,
                _d.rightSum + _d.medianWeight,
                _index,
                _price,
                _weight
            );
        }

        // procedure to find the third quartile bound
        if (_d.medianIndex == count - 1) {
            // third quartile index is count - 1
            (_d.quartile3Index, , _d.highWeightSum) = (_d.medianIndex, _d.leftSum, 0);
        } else if (_d.rightSum <= totalSum / 4) {
            // right sum for median is below the third quartile threshold
            (_d.quartile3Index, , _d.highWeightSum) = (_d.medianIndex, _d.leftSum, _d.rightSum);
        } else {
            // quick select algorithm to find the third quartile bound (without moving the median index)
            (_d.quartile3Index, , _d.highWeightSum) = _quickSelect(
                3,
                _d.medianIndex + 1,
                count - 1,
                _d.leftSum + _d.medianWeight,
                0,
                _index,
                _price,
                _weight
            );
        }

        // final median price computation
        _d.finalMedianPrice = _price[_index[_d.medianIndex]];
        if (_d.leftSum + _d.medianWeight == totalSum / 2 && totalSum % 2 == 0) {
            // if median is "in the middle", take the average price of the two consecutive prices
            _d.finalMedianPrice =
                (_d.finalMedianPrice + _closestPriceFix(_d.medianIndex, count - 1, _index, _price)) / 2;
        }

        // calculation of first and third quartile index to include indices with the same price
        (_d.quartile1Index, _d.lowWeightSum) = _samePriceFix(
            _d.quartile1Index, 0, -1, _d.lowWeightSum, _index, _price, _weight);
        (_d.quartile3Index, _d.highWeightSum) = _samePriceFix(
            _d.quartile3Index, count - 1, 1, _d.highWeightSum, _index, _price, _weight);

        // store the first and third quartile prices
        _d.quartile1Price = _price[_index[_d.quartile1Index]];
        _d.quartile3Price = _price[_index[_d.quartile3Index]];

        // reward weight sum
        _d.rewardedWeightSum = totalSum - _d.lowWeightSum - _d.highWeightSum;

        // calculate low and high elastic band prices
        uint256 elasticBandPriceDiff = _d.finalMedianPrice * _elasticBandWidthPPM / 1e6;
        _d.lowElasticBandPrice = _d.finalMedianPrice - elasticBandPriceDiff;
        _d.highElasticBandPrice = _d.finalMedianPrice + elasticBandPriceDiff;
    }

    /**
     * @notice Performs quick select algorithm
     */
    function _quickSelect(
        uint256 _k,
        uint256 _start,
        uint256 _end,
        uint256 _leftSumInit,
        uint256 _rightSumInit,
        uint256[] memory _index,
        uint256[] memory _price, 
        uint256[] memory _weight
     )
        internal view returns (uint256, uint256, uint256)
     {
        if (_start == _end) {
            return (_start, _leftSumInit, _rightSumInit);
        }
        QSVariables memory s;
        s.leftSum = _leftSumInit;
        s.rightSum = _rightSumInit;
        QSPositions memory p;
        p.left = _start;
        p.right = _end;
        uint256 random = uint256(keccak256(abi.encode(block.difficulty, block.timestamp)));
        uint256 totalSum; 
        while (true) {
            // guarantee: pos is in [left,right] and newLeftSum >= leftSum, newRightSum >= rightSum !!!
            //slither-disable-next-line weak-prng       // no need for secure random, at worst more gas used
            (p.pos, s.newLeftSum, s.newRightSum) = _partition(
                p.left,
                p.right,
                (random % (p.right - p.left + 1)) + p.left, // pivot randomization
                s.leftSum,
                s.rightSum,
                _index,
                _price,
                _weight
            );
            
            p.pivotId = _index[p.pos];
            s.pivotWeight = _weight[p.pivotId];
            totalSum = s.pivotWeight + s.newLeftSum + s.newRightSum;
            if (_k == 2) {
                // last element of s.leftMedianWeight is the real median
                s.leftMedianWeight = totalSum / 2 + (totalSum % 2);  
                s.rightMedianWeight = totalSum - s.leftMedianWeight; 
                // if newSumLeft is contains the median weight!
                if (s.newLeftSum >= s.leftMedianWeight && s.leftMedianWeight > _leftSumInit) { 
                    p.right = p.pos - 1;
                    s.rightSum = s.pivotWeight + s.newRightSum;
                } else if (s.newRightSum > s.rightMedianWeight && s.rightMedianWeight > _rightSumInit) {
                    p.left = p.pos + 1;
                    s.leftSum = s.pivotWeight + s.newLeftSum;
                } else {
                    return (p.pos, s.newLeftSum, s.newRightSum);
                }
            } else if (_k == 1) {
                s.leftMedianWeight = totalSum / 4;
                // rightMedianWeight contains the correct first weight
                s.rightMedianWeight = totalSum - s.leftMedianWeight;
                if (s.newLeftSum > s.leftMedianWeight && s.leftMedianWeight > _leftSumInit) { 
                    p.right = p.pos - 1;
                    s.rightSum = s.pivotWeight + s.newRightSum;
                } else if (s.newRightSum >= s.rightMedianWeight && s.rightMedianWeight > _rightSumInit) {
                    p.left = p.pos + 1;
                    s.leftSum = s.pivotWeight + s.newLeftSum;
                } else {
                    return (p.pos, s.newLeftSum, s.newRightSum);
                }
            } else { // k = 3 - outward bias due to division
                s.rightMedianWeight = totalSum / 4;
                // leftMedianWeight contains the correct last weight
                s.leftMedianWeight = totalSum - s.rightMedianWeight;
                if (s.newLeftSum >= s.leftMedianWeight && s.leftMedianWeight > _leftSumInit) { 
                    p.right = p.pos - 1;
                    s.rightSum = s.pivotWeight + s.newRightSum;
                } else if (s.newRightSum > s.rightMedianWeight && s.rightMedianWeight > _rightSumInit) {
                    p.left = p.pos + 1;
                    s.leftSum = s.pivotWeight + s.newLeftSum;
                } else {
                    return (p.pos, s.newLeftSum, s.newRightSum);
                }
            }
        }

        // should never happen
        assert(false);
        return (0, 0, 0);
    }

    /**
     * @notice Partitions the index array `index` according to the pivot
     */
    function _partition(
        uint256 left0,
        uint256 right0,
        uint256 pivotId,
        uint256 leftSum0, 
        uint256 rightSum0,
        uint256[] memory index,
        uint256[] memory price, 
        uint256[] memory weight
    )
        internal pure returns (uint256, uint256, uint256)
    {
        uint256 pivotValue = price[index[pivotId]];
        uint256[] memory sums = new uint256[](2);
        sums[0] = leftSum0;
        sums[1] = rightSum0;
        uint256 left = left0;
        uint256 right = right0;
        _swap(pivotId, right, index);
        uint256 storeIndex = left;
        for (uint256 i = left; i < right; i++) {
            uint256 eltId = index[i];
            if (price[eltId] < pivotValue) {
                sums[0] += weight[eltId];
                // move index to the left
                _swap(storeIndex, i, index);
                storeIndex++;
            } else {
                sums[1] += weight[eltId];
            }
        }
        _swap(right, storeIndex, index);
        return (storeIndex, sums[0], sums[1]);
    }

    /**
     * @notice Swaps indices `_i` and `_j` in the index array `_index` 
     */
    function _swap(uint256 _i, uint256 _j, uint256[] memory _index) internal pure {
        if (_i == _j) return;
        (_index[_i], _index[_j]) = (_index[_j], _index[_i]);
    }

    /**
     * @notice Handles the same price at the first or third quartile index
     */
    function _samePriceFix(
        uint256 _start,
        uint256 _end,
        int256 _direction,
        uint256 _sumInit,
        uint256[] memory _index,
        uint256[] memory _price,
        uint256[] memory _weight
    )
        internal pure returns (uint256, uint256)
    {
        uint256 weightSum = _sumInit;
        if ((int256(_start) - int256(_end)) * _direction >= 0) return (_start, _sumInit);
        uint256 thePrice = _price[_index[_start]];
        int256 storeIndex = int256(_start) + _direction;
        uint256 eltId;
        for (int256 i = int256(_start) + _direction; (i - int256(_end)) * _direction <= 0; i += _direction) {
            eltId = _index[uint256(i)];
            if (_price[eltId] == thePrice) {
                weightSum -= _weight[eltId];
                _swap(uint256(storeIndex), uint256(i), _index);
                storeIndex += _direction;
            }
        }
        return (uint256(storeIndex - _direction), weightSum);
    }

    /**
     * @notice Finds the price between `_start + 1` and `_end`that is the closest to the price at `_start` index
     * @dev If _start = _end, _price[_start] is returned
     */
    function _closestPriceFix(
        uint256 _start,
        uint256 _end,
        uint256[] memory _index,
        uint256[] memory _price
    )
        internal pure returns (uint256)
    {
        if (_start == _end) {
            // special case
            return _price[_index[_start]];
        }

        // find the closest price between `_start + 1` and `_end`
        uint256 closestPrice = _price[_index[_start + 1]];
        uint256 newPrice;
        for (uint256 i = _start + 2; i <= _end; i++) {
            newPrice = _price[_index[i]];
            // assumes all the elements to the right of start are greater or equal 
            if (newPrice < closestPrice) {
                closestPrice = newPrice;
            }
        }
        return closestPrice;
    }

    
    /**
     * @notice Computes the simple median price (using insertion sort) - sorts original array
     * @param _prices               positional array of prices to be sorted
     * @return _finalMedianPrice    median price
     */
    function _computeSimple(
        uint256[] memory _prices
    ) 
        internal pure 
        returns (
            uint256 _finalMedianPrice
        )
    {
        uint256 length = _prices.length;
        assert(length > 0);

        for (uint256 i = 1; i < length; i++) {
            // price to sort next
            uint256 currentPrice = _prices[i];

            // shift bigger prices right
            uint256 j = i;
            while (j > 0 && _prices[j - 1] > currentPrice) {
                _prices[j] = _prices[j - 1];
                j--; // no underflow
            }
            // insert 
            _prices[j] = currentPrice;
        }

        uint256 middleIndex = length / 2;
        if (length % 2 == 1) {
            return _prices[middleIndex];
        } else {
            // if median is "in the middle", take the average price of the two consecutive prices
            return (_prices[middleIndex - 1] + _prices[middleIndex]) / 2;
        }
    }
}
