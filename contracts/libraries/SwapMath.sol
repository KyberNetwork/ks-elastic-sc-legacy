// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

import {MathConstants} from './MathConstants.sol';
import {FullMath} from './FullMath.sol';
import {SafeCast} from './SafeCast.sol';

/// @title Contains helper functions for swaps
library SwapMath {
  using SafeCast for uint256;
  using SafeCast for int256;

  // calculates the delta qty amount needed to reach sqrtPn (price of next tick)
  // from sqrtPc (price of current tick)
  function calcDeltaNext(
    uint256 lpPluslf,
    uint160 sqrtPc,
    uint160 sqrtPn,
    uint16 feeInBps,
    bool isExactInput,
    bool isToken0
  ) internal pure returns (int256 deltaNext) {
    // numerator = 2 * (lp + lf) * (diffInSqrtPrice)
    // we ensure diffInSqrtPrice > 0 first, the make negative
    // if exact output is specified
    uint256 numerator = FullMath.mulDivFloor(
      2 * lpPluslf,
      (sqrtPc >= sqrtPn) ? (sqrtPc - sqrtPn) : (sqrtPn - sqrtPc),
      MathConstants.TWO_POW_96
    );
    uint256 denominator;
    if (isToken0) {
      // denominator (exact input): calculate 2 * sqrtPn - feeInBps * sqrtPc / BPS
      // denominator (exact output): calculate 2 * sqrtPn - feeInBps * BPS * sqrtPc / (BPS * (BPS - feeInBps))
      // which is simplified to 2 * sqrtPn - feeInBps * sqrtPc / (BPS - feeInBps)
      denominator = sqrtPc * feeInBps;
      denominator =
        denominator /
        (isExactInput ? MathConstants.BPS : (MathConstants.BPS - feeInBps));
      denominator = 2 * sqrtPn - denominator;
      denominator = FullMath.mulDivCeiling(sqrtPc, denominator, MathConstants.TWO_POW_96);
      deltaNext = FullMath
      .mulDivFloor(numerator, MathConstants.TWO_POW_96, denominator)
      .toInt256();
    } else {
      denominator = feeInBps * sqrtPn;
      denominator =
        denominator /
        (isExactInput ? MathConstants.BPS : (MathConstants.BPS - feeInBps));
      denominator = (2 * sqrtPc - denominator);
      deltaNext = FullMath.mulDivFloor(numerator, sqrtPc, denominator).toInt256();
    }
    if (!isExactInput) deltaNext = -deltaNext;
  }

  struct SwapParams {
    // if won't cross tick, deltaRemaining;
    // else, deltaNext (delta qty needed to cross next tick)
    int256 deltaRemaining;
    int256 actualDelta;
    uint256 lpPluslf;
    uint256 lc;
    uint160 sqrtPc;
    uint160 sqrtPn;
    uint16 swapFeeBps;
    bool isExactInput;
    bool isToken0;
    // true if needed to calculate final sqrt price, false otherwise
    bool calcFinalPrice;
  }

  // calculates actual delta and fee amounts (lc and governmentFee)
  // in addition, will return non-zero sqrtPn if calcFinalPrice is true
  function calcSwapInTick(SwapParams memory swapParams)
    internal
    pure
    returns (
      int256 actualDelta,
      uint256 lc,
      uint160 sqrtPn
    )
  {
    uint256 absDelta = swapParams.deltaRemaining >= 0
      ? uint256(swapParams.deltaRemaining)
      : swapParams.deltaRemaining.revToUint256();
    // calculate fee amounts
    swapParams.lc = calcSwapFeeAmounts(
      absDelta,
      swapParams.sqrtPc,
      swapParams.swapFeeBps,
      swapParams.isExactInput,
      swapParams.isToken0
    );

    if (swapParams.calcFinalPrice) {
      // calculate final sqrt price
      swapParams.sqrtPn = calcFinalPrice(
        absDelta,
        swapParams.lpPluslf,
        swapParams.lc,
        swapParams.sqrtPc,
        swapParams.isExactInput,
        swapParams.isToken0
      );
    }
    // calculate actualDelta
    actualDelta =
      swapParams.actualDelta +
      calcActualDelta(
        swapParams.lpPluslf,
        swapParams.sqrtPc,
        swapParams.sqrtPn,
        swapParams.lc,
        swapParams.isExactInput,
        swapParams.isToken0
      );

    return (actualDelta, swapParams.lc, swapParams.sqrtPn);
  }

  function calcSwapFeeAmounts(
    uint256 absDelta,
    uint160 sqrtPc,
    uint16 swapFeeBps,
    bool isExactInput,
    bool isToken0
  ) internal pure returns (uint256 lc) {
    if (isToken0) {
      lc = FullMath.mulDivFloor(
        sqrtPc,
        absDelta * swapFeeBps,
        2 *
          MathConstants.TWO_POW_96 *
          (isExactInput ? MathConstants.BPS : MathConstants.BPS - swapFeeBps)
      );
    } else {
      lc = FullMath.mulDivFloor(
        MathConstants.TWO_POW_96,
        absDelta * swapFeeBps,
        2 * sqrtPc * (isExactInput ? MathConstants.BPS : MathConstants.BPS - swapFeeBps)
      );
    }
  }

  // will round down sqrtPn
  function calcFinalPrice(
    uint256 absDelta,
    uint256 lpPluslf,
    uint256 lc,
    uint160 sqrtPc,
    bool isExactInput,
    bool isToken0
  ) internal pure returns (uint160 sqrtPn) {
    uint256 numerator;
    if (isToken0) {
      numerator = FullMath.mulDivFloor(lpPluslf + lc, sqrtPc, MathConstants.TWO_POW_96);
      uint256 denominator = FullMath.mulDivCeiling(absDelta, sqrtPc, MathConstants.TWO_POW_96);
      sqrtPn = (FullMath.mulDivFloor(
        numerator,
        MathConstants.TWO_POW_96,
        isExactInput ? lpPluslf + denominator : lpPluslf - denominator
      ))
      .toUint160();
    } else {
      numerator = FullMath.mulDivFloor(lpPluslf, sqrtPc, MathConstants.TWO_POW_96);
      numerator = isExactInput ? numerator + absDelta : numerator - absDelta;
      sqrtPn = FullMath
      .mulDivFloor(numerator, MathConstants.TWO_POW_96, lpPluslf + lc)
      .toUint160();
    }
  }

  // calculates actual output | input tokens in exchange for
  // user specified input | output
  // round down when calculating actual output (isExactInput) so we avoid sending too much
  // round up when calculating actual input (!isExactInput) so we get desired output amount
  function calcActualDelta(
    uint256 lpPluslf,
    uint160 sqrtPc,
    uint160 sqrtPn,
    uint256 lc,
    bool isExactInput,
    bool isToken0
  ) internal pure returns (int256 actualDelta) {
    if (isToken0) {
      // require difference in sqrtPc and sqrtPn > 0
      // so that we can properly do the multiplication of (lp + lf)|sqrtPc - sqrtPn|
      // hence, if user specified
      // exact input: actualDelta = lc(sqrtPn) - [(lp + lf)(sqrtPc - sqrtPn)]
      // exact output: actualDelta = lc(sqrtPn) + (lp + lf)(sqrtPn - sqrtPc)

      if (isExactInput) {
        // round down actual output so we avoid sending too much
        // actualDelta = lc(sqrtPn) - [(lp + lf)(sqrtPc - sqrtPn)]
        actualDelta =
          FullMath.mulDivFloor(lc, sqrtPn, MathConstants.TWO_POW_96).toInt256() +
          FullMath
          .mulDivCeiling(lpPluslf, sqrtPc - sqrtPn, MathConstants.TWO_POW_96)
          .revToInt256();
      } else {
        // round up actual input so we get desired output amount
        // actualDelta = lc(sqrtPn) + (lp + lf)(sqrtPn - sqrtPc)
        actualDelta =
          FullMath.mulDivCeiling(lc, sqrtPn, MathConstants.TWO_POW_96).toInt256() +
          FullMath.mulDivCeiling(lpPluslf, sqrtPn - sqrtPc, MathConstants.TWO_POW_96).toInt256();
      }
    } else {
      // actualDelta = (lp + lf + lc)/sqrtPn - (lp + lf)/sqrtPc
      if (isExactInput) {
        // round down actual output so we avoid sending too much
        actualDelta =
          FullMath.mulDivFloor(lpPluslf + lc, MathConstants.TWO_POW_96, sqrtPn).toInt256() +
          FullMath.mulDivCeiling(lpPluslf, MathConstants.TWO_POW_96, sqrtPc).revToInt256();
      } else {
        // round up actual input so we get desired output amount
        actualDelta =
          FullMath.mulDivCeiling(lpPluslf + lc, MathConstants.TWO_POW_96, sqrtPn).toInt256() +
          FullMath.mulDivFloor(lpPluslf, MathConstants.TWO_POW_96, sqrtPc).revToInt256();
      }
    }
  }
}
