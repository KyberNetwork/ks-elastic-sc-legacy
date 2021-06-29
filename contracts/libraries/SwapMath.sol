// SPDX-License-Identifier: MIT
pragma solidity 0.8.5;

import './FullMath.sol';

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
  ) public pure returns (int256 deltaNext) {
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
      denominator = FullMath.mulDivCeiling(sqrtPc, denominator, TWO_POW_96);
      deltaNext = int256(FullMath.mulDivFloor(numerator, TWO_POW_96, denominator));
    } else {
      denominator = feeInBps * sqrtPn;
      denominator = denominator / (isExactInput ? BPS : (BPS - feeInBps));
      denominator = (2 * sqrtPc - denominator) / TWO_POW_96;
      numerator = FullMath.mulDivFloor(numerator, sqrtPc, TWO_POW_96);
      deltaNext = int256(numerator / denominator);
    }
    if (!isExactInput) deltaNext = -deltaNext;
  }

  function calculateLc(
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
    uint160 sqrtPc,
    uint128 lc,
    bool isToken0
  ) external pure returns (uint160 sqrtPn) {
    uint256 numerator;
    if (isToken0) {
      numerator = FullMath.mulDivFloor(lpPluslf + lc, sqrtPc, TWO_POW_96);
      uint256 denominator = FullMath.mulDivCeiling(deltaRemaining, sqrtPc, TWO_POW_96);
      sqrtPn = uint160(numerator / (denominator + lpPluslf));
    } else {
      numerator = deltaRemaining + FullMath.mulDivFloor(lpPluslf, sqrtPc, TWO_POW_96);
      sqrtPn = uint160(numerator / (lpPluslf + lc));
    }
  }

  // calculates actual output | input tokens to be exchanged
  // for user specified input | output
  function calculateActualDelta(
    uint256 lpPluslf,
    uint160 sqrtPc,
    bool isToken0,
    bool isExactInput,
    uint128 lc,
    uint160 sqrtPn
  ) external pure returns (int256 actualDelta) {
    if (isToken0) {
      // require difference in sqrtPc and sqrtPn > 0
      // so that we can properly do the multiplication of (lp + lf)|sqrtPc - sqrtPn|
      // hence, if user specified
      // exact input: actualDelta = lc(sqrtPn) - [(lp + lf)(sqrtPc - sqrtPn)]
      // exact output: actualDelta = lc(sqrtPn) + (lp + lf)(sqrtPn - sqrtPc)
      uint256 result = FullMath.mulDivFloor(lc, sqrtPn, TWO_POW_96);

      if (isExactInput) {
        // token0 in
        actualDelta =
          int256(result) -
          int256(FullMath.mulDivFloor(lpPluslf, sqrtPc - sqrtPn, TWO_POW_96));
      } else {
        // token0 out
        actualDelta =
          int256(result) +
          int256(FullMath.mulDivFloor(lpPluslf, sqrtPn - sqrtPc, TWO_POW_96));
      }
    } else {
      // actualDelta = (lp + lf + lc)/sqrtPn - (lp + lf)/sqrtPc
      actualDelta =
        int256(FullMath.mulDivFloor(lpPluslf + lc, TWO_POW_96, sqrtPn)) -
        int256(FullMath.mulDivFloor(lpPluslf, TWO_POW_96, sqrtPc));
    }
  }
}
