// SPDX-License-Identifier: MIT
pragma solidity 0.8.5;

import "./FullMath.sol";

/// @title Contains helper functions for swaps
library SwapMath {
    uint256 internal constant TWO_POW_96 = 0x1000000000000000000000000;
    uint24 internal constant BPS = 10000;

    function calculateDeltaNext(
        uint160 sqrtPc,
        uint160 sqrtPn,
        uint128 liquidity,
        uint24 feeInBps,
        bool isExactInput,
        bool isToken0
    ) public pure returns (int256 deltaAmount) {
        // numerator = 2 * (lp + lf) * (diffInSqrtPrice)
        // we ensure diffInSqrtPrice > 0 first, the make negative
        // if exact output is specified
        uint256 numerator = 2 * liquidity;
        numerator = FullMath.mulDivFloor(
            numerator,
            (sqrtPc >= sqrtPn) ? (sqrtPc - sqrtPn) : (sqrtPn - sqrtPc),
            TWO_POW_96
        );
        uint256 denominator;
        if (isToken0) {
            // calculate 2 * sqrtPn - sqrtPc * feeInBps
            // divide by BPS | (BPS - feeInBps) for exact input | output
            denominator = sqrtPc * feeInBps;
            denominator = denominator / (isExactInput ? BPS : (BPS - feeInBps));
            denominator = 2 * sqrtPn - denominator;
            denominator = FullMath.mulDivCeiling(
                sqrtPc,
                denominator,
                TWO_POW_96
            );
            deltaAmount = int256(FullMath.mulDivFloor(
                numerator,
                TWO_POW_96,
                denominator));
        } else {
            denominator = feeInBps * sqrtPn;
            denominator = denominator / (isExactInput ? BPS : (BPS - feeInBps));
            denominator = (2 * sqrtPc - denominator) / TWO_POW_96;
            numerator = FullMath.mulDivFloor(
                numerator,
                sqrtPc,
                TWO_POW_96);
            deltaAmount = int256(numerator / denominator);
        }
        if (!isExactInput) deltaAmount = -deltaAmount;
    }

    function calculateCollectedLiquidity(
        uint256 delta,
        uint24 feeInBps,
        bool isExactInput,
        bool isToken0,
        uint160 sqrtPc
    ) external pure returns (uint128 lc) {
        if (isToken0) {
            lc = uint128(
                FullMath.mulDivFloor(
                    sqrtPc,
                    delta * feeInBps,
                    2 * TWO_POW_96 * (isExactInput ? BPS : BPS - feeInBps)
                )
            );
        } else {
            lc = uint128(
                FullMath.mulDivFloor(
                    TWO_POW_96,
                    delta * feeInBps,
                    2 * sqrtPc * (isExactInput ? BPS : BPS - feeInBps)
                )
            );
        }
    }

    function calculateFinalPrice(
        uint256 lpPluslf,
        uint256 deltaRemaining,
        uint128 lc,
        bool isToken0,
        uint160 sqrtPc
    ) external pure returns (uint160 sqrtPn) {
        uint256 numerator;
        if (isToken0) {
            numerator = FullMath.mulDivFloor(
                lpPluslf + lc,
                sqrtPc,
                TWO_POW_96
            );
            uint256 denominator = FullMath.mulDivCeiling(
                deltaRemaining,
                sqrtPc,
                TWO_POW_96
            );
            sqrtPn = uint160(numerator / (denominator + lpPluslf));
        } else {
            numerator = deltaRemaining + FullMath.mulDivFloor(
                lpPluslf,
                sqrtPc,
                TWO_POW_96
            );
            sqrtPn = uint160(numerator / (lpPluslf + lc));
        }
    }
}
