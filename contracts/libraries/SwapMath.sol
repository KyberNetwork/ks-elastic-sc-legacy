// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

import {MathConstants} from './MathConstants.sol';
import {FullMath} from './FullMath.sol';
import {SafeCast} from './SafeCast.sol';

/// @title Contains helper functions for swaps
library SwapMath {
  using SafeCast for uint256;
  using SafeCast for int256;

  function computeSwapStep(
    uint256 liquidity,
    uint160 currentSqrtP,
    uint160 targetSqrtP,
    uint16 feeInBps,
    int256 amountRemaining,
    bool isExactInput
  )
    internal
    pure
    returns (
      int256 delta,
      int256 actualDelta,
      uint256 fee,
      uint160 nextSqrtP
    )
  {
    // if isExactInput, isToken0 == !willUpTick else isToken0 = willUpTick;
    bool isToken0 = isExactInput ? (currentSqrtP > targetSqrtP) : (currentSqrtP < targetSqrtP);

    delta = calcDeltaNext(liquidity, currentSqrtP, targetSqrtP, feeInBps, isExactInput, isToken0);

    if (isExactInput) {
      if (delta >= amountRemaining) {
        delta = amountRemaining;
      } else {
        nextSqrtP = targetSqrtP;
      }
    } else {
      if (delta <= amountRemaining) {
        delta = amountRemaining;
      } else {
        nextSqrtP = targetSqrtP;
      }
    }
    uint256 absDelta = delta >= 0 ? uint256(delta) : delta.revToUint256();
    fee = calcSwapFeeAmounts(absDelta, currentSqrtP, feeInBps, isExactInput, isToken0);
    if (nextSqrtP == 0) {
      nextSqrtP = calcFinalPrice(absDelta, liquidity, fee, currentSqrtP, isExactInput, isToken0);
      // special case when nextSqrtP > targetSqrtP > currentSqrtP due to rounding problems
      if (!isToken0 && isExactInput && nextSqrtP > targetSqrtP) {
        nextSqrtP = targetSqrtP;
      }
    }
    actualDelta = calcActualDelta(liquidity, currentSqrtP, nextSqrtP, fee, isExactInput, isToken0);
  }

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
      if (isExactInput) {
        denominator = 2 * sqrtPn * MathConstants.BPS - feeInBps * sqrtPc;
        uint256 tmp = FullMath.mulDivFloor(
          2 * lpPluslf,
          (sqrtPc - sqrtPn) * MathConstants.BPS,
          denominator
        );
        deltaNext = FullMath.mulDivFloor(tmp, MathConstants.TWO_POW_96, sqrtPc).toInt256();
      } else {
        denominator = (sqrtPc * feeInBps) / (MathConstants.BPS - feeInBps);
        denominator = 2 * sqrtPn - denominator;
        denominator = FullMath.mulDivCeiling(sqrtPc, denominator, MathConstants.TWO_POW_96);
        deltaNext = FullMath
        .mulDivFloor(numerator, MathConstants.TWO_POW_96, denominator)
        .toInt256();
      }
    } else {
      if (isExactInput) {
        denominator = 2 * sqrtPc * MathConstants.BPS - feeInBps * sqrtPn;
        uint256 tmp = FullMath.mulDivFloor(
          2 * lpPluslf,
          (sqrtPn - sqrtPc) * MathConstants.BPS,
          MathConstants.TWO_POW_96
        );
        deltaNext = FullMath.mulDivFloor(tmp, sqrtPc, denominator).toInt256();
      } else {
        denominator = (feeInBps * sqrtPn) / (MathConstants.BPS - feeInBps);
        denominator = (2 * sqrtPc - denominator);
        deltaNext = FullMath.mulDivFloor(numerator, sqrtPc, denominator).toInt256();
      }
    }
    if (!isExactInput) deltaNext = -deltaNext;
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
    if (isToken0) {
      // round Up
      uint256 denominator = FullMath.mulDivFloor(absDelta, sqrtPc, MathConstants.TWO_POW_96);
      sqrtPn = (
        FullMath.mulDivCeiling(
          lpPluslf + lc,
          sqrtPc,
          isExactInput ? lpPluslf + denominator : lpPluslf - denominator
        )
      )
      .toUint160();
    } else {
      // round down
      sqrtPn = (FullMath.mulDivFloor(lpPluslf, sqrtPc, lpPluslf + lc) +
        FullMath.mulDivFloor(absDelta, MathConstants.TWO_POW_96, lpPluslf + lc))
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
