// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

import {MathConstants} from './MathConstants.sol';
import {FullMath} from './FullMath.sol';
import {SafeCast} from './SafeCast.sol';

/// @title Contains helper functions for swaps
library SwapMath {
  using SafeCast for uint256;

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
    uint256 numerator = 2 * lpPluslf;
    numerator = FullMath.mulDivFloor(
      numerator,
      (sqrtPc >= sqrtPn) ? (sqrtPc - sqrtPn) : (sqrtPn - sqrtPc),
      MathConstants.TWO_POW_96
    );
    uint256 denominator;
    if (isToken0) {
      // calculate 2 * sqrtPn - sqrtPc * feeInBps
      // divide by MathConstants.BPS | (MathConstants.BPS - feeInBps) for exact input | output
      denominator = sqrtPc * feeInBps;
      denominator =
        denominator /
        (isExactInput ? MathConstants.BPS : (MathConstants.BPS - feeInBps));
      denominator = 2 * sqrtPn - denominator;
      denominator = FullMath.mulDivCeiling(sqrtPc, denominator, MathConstants.TWO_POW_96);
      deltaNext = int256(FullMath.mulDivFloor(numerator, MathConstants.TWO_POW_96, denominator));
    } else {
      denominator = feeInBps * sqrtPn;
      denominator =
        denominator /
        (isExactInput ? MathConstants.BPS : (MathConstants.BPS - feeInBps));
      denominator = (2 * sqrtPc - denominator) / MathConstants.TWO_POW_96;
      numerator = FullMath.mulDivFloor(numerator, sqrtPc, MathConstants.TWO_POW_96);
      deltaNext = int256(numerator / denominator);
    }
    if (!isExactInput) deltaNext = -deltaNext;
  }

  struct SwapParams {
    // if won't cross tick, deltaRemaining;
    // else, deltaNext (delta qty needed to cross next tick)
    int256 delta;
    uint256 lpPluslf;
    uint256 lc;
    uint256 governmentFee;
    uint160 sqrtPc;
    uint160 sqrtPn;
    uint16 swapFeeBps;
    uint16 governmentFeeBps;
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
      uint256 governmentFee,
      uint160 sqrtPn
    )
  {
    uint256 governmentFeeQty;
    uint256 absDelta = swapParams.delta >= 0
      ? uint256(swapParams.delta)
      : type(uint256).max - uint256(swapParams.delta) + 1;
    // calculate fee amounts
    (swapParams.lc, governmentFeeQty) = calcSwapFeeAmounts(
      absDelta,
      swapParams.sqrtPc,
      swapParams.swapFeeBps,
      swapParams.governmentFeeBps,
      swapParams.isExactInput,
      swapParams.isToken0
    );

    swapParams.governmentFee += governmentFeeQty;

    if (swapParams.calcFinalPrice) {
      // calculate final sqrt price
      swapParams.sqrtPn = calcFinalPrice(
        absDelta,
        swapParams.lpPluslf,
        swapParams.lc,
        swapParams.sqrtPc,
        swapParams.isToken0
      );
    }

    // calculate actualDelta
    actualDelta += calcActualDelta(
      swapParams.lpPluslf,
      swapParams.sqrtPc,
      swapParams.sqrtPn,
      swapParams.lc,
      swapParams.isExactInput,
      swapParams.isToken0
    );

    return (actualDelta, swapParams.lc, swapParams.governmentFee, swapParams.sqrtPn);
  }

  function calcSwapFeeAmounts(
    uint256 absDelta,
    uint160 sqrtPc,
    uint16 swapFeeBps,
    uint16 governmentFeeBps,
    bool isExactInput,
    bool isToken0
  ) internal pure returns (uint256 lc, uint256 governmentFeeQty) {
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
    governmentFeeQty = (lc * (MathConstants.BPS - governmentFeeBps)) / MathConstants.BPS;
    lc -= governmentFeeQty;
  }

  function calcFlashFeeAmounts(
    uint256 swapFeeDelta,
    uint160 sqrtPc,
    uint16 governmentFeeBps,
    bool isToken0
  ) internal pure returns (uint256 lc, uint256 governmentFeeQty) {
    if (isToken0) {
      lc = FullMath.mulDivFloor(sqrtPc, swapFeeDelta, 2 * MathConstants.TWO_POW_96);
    } else {
      lc = FullMath.mulDivFloor(MathConstants.TWO_POW_96, swapFeeDelta, 2 * sqrtPc);
    }
    governmentFeeQty = (lc * (MathConstants.BPS - governmentFeeBps)) / MathConstants.BPS;
    lc -= governmentFeeQty;
  }

  // will round down sqrtPn
  function calcFinalPrice(
    uint256 absDelta,
    uint256 lpPluslf,
    uint256 lc,
    uint160 sqrtPc,
    bool isToken0
  ) internal pure returns (uint160 sqrtPn) {
    uint256 numerator;
    if (isToken0) {
      numerator = FullMath.mulDivFloor(lpPluslf + lc, sqrtPc, MathConstants.TWO_POW_96);
      uint256 denominator = FullMath.mulDivCeiling(absDelta, sqrtPc, MathConstants.TWO_POW_96);
      sqrtPn = (FullMath.mulDivFloor(numerator, MathConstants.TWO_POW_96, denominator + lpPluslf))
        .toUint160();
    } else {
      numerator = absDelta + FullMath.mulDivFloor(lpPluslf, sqrtPc, MathConstants.TWO_POW_96);
      sqrtPn = (FullMath.mulDivFloor(numerator, MathConstants.TWO_POW_96, lpPluslf + lc))
        .toUint160();
    }
  }

  // calculates actual output | input tokens in exchange for
  // user specified input | output
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
      // exact input: actualDelta = -[(lp + lf)(sqrtPc - sqrtPn)] + lc(sqrtPn)
      // exact output: actualDelta = (lp + lf)(sqrtPn - sqrtPc) + lc(sqrtPn)

      // result = lc(sqrtPn)
      uint256 result = FullMath.mulDivFloor(lc, sqrtPn, MathConstants.TWO_POW_96);

      if (isExactInput) {
        // actualDelta = -[(lp + lf)(sqrtPc - sqrtPn)] + result
        actualDelta = int256(
          type(uint256).max -
            FullMath.mulDivFloor(lpPluslf, sqrtPc - sqrtPn, MathConstants.TWO_POW_96) +
            1 +
            result
        );
      } else {
        // actualDelta = (lp + lf)(sqrtPc - sqrtPn) + result
        actualDelta = int256(
          FullMath.mulDivFloor(lpPluslf, sqrtPn - sqrtPc, MathConstants.TWO_POW_96) + result
        );
      }
    } else {
      // actualDelta = -(lp + lf)/sqrtPc + (lp + lf + lc)/sqrtPn
      actualDelta = int256(
        type(uint256).max -
          FullMath.mulDivFloor(lpPluslf, MathConstants.TWO_POW_96, sqrtPc) +
          1 +
          FullMath.mulDivFloor(lpPluslf + lc, MathConstants.TWO_POW_96, sqrtPn)
      );
    }
  }
}
