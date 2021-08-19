// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

import {MathConstants as C} from './MathConstants.sol';
import {FullMath} from './FullMath.sol';
import {QuadMath} from './QuadMath.sol';
import {SafeCast} from './SafeCast.sol';

// import 'hardhat/console.sol';

/// @title Contains helper functions for swaps
library SwapMath {
  using SafeCast for uint256;
  using SafeCast for int256;

  function computeSwapStep(
    uint256 liquidity,
    uint160 currentSqrtP,
    uint160 targetSqrtP,
    uint256 feeInBps,
    int256 amountRemaining,
    bool isExactInput,
    bool isToken0
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
    // in the event currentSqrtP == targetSqrtP because of tick movements, return
    // eg. swapped up tick where specified price limit is on an initialised tick
    // then swapping down tick will cause next tick to be the same as the current tick
    if (currentSqrtP == targetSqrtP) return (0, 0, 0, currentSqrtP);
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
    if (nextSqrtP == 0) {
      fee = calcFinalSwapFeeAmount(
        absDelta,
        liquidity,
        currentSqrtP,
        feeInBps,
        isExactInput,
        isToken0
      );
      nextSqrtP = calcFinalPrice(absDelta, liquidity, fee, currentSqrtP, isExactInput, isToken0);
      if (!isToken0 && isExactInput && nextSqrtP > targetSqrtP) {
        nextSqrtP = targetSqrtP;
      }
    } else {
      fee = calcStepSwapFeeAmount(
        absDelta,
        liquidity,
        currentSqrtP,
        nextSqrtP,
        isExactInput,
        isToken0
      );
    }
    actualDelta = calcActualDelta(liquidity, currentSqrtP, nextSqrtP, fee, isExactInput, isToken0);
  }

  // calculates the delta qty amount needed to reach sqrtPn (price of next tick)
  // from sqrtPc (price of current tick)
  // each of the 4 possible scenarios (isExactInput | isToken0)
  // have vastly different formulas which are elaborated in each branch
  function calcDeltaNext(
    uint256 liquidity,
    uint160 sqrtPc,
    uint160 sqrtPn,
    uint256 feeInBps,
    bool isExactInput,
    bool isToken0
  ) internal pure returns (int256 deltaNext) {
    uint256 absPriceDiff;
    unchecked {
      absPriceDiff = (sqrtPc >= sqrtPn) ? (sqrtPc - sqrtPn) : (sqrtPn - sqrtPc);
    }
    uint256 numerator;
    uint256 denominator;
    if (isExactInput) {
      // we round down so that we avoid taking giving away too much for the specified input
      // ie. require less input qty to move ticks
      if (isToken0) {
        // numerator = 2 * liquidity * absPriceDiff
        // denominator = sqrtPc * (2 * sqrtPn - sqrtPc * feeInBps / BPS)
        unchecked {
          // overflow should not happen because the absPriceDiff is capped to ~5%
          denominator = C.TWO_BPS * sqrtPn - feeInBps * sqrtPc;
          numerator = FullMath.mulDivFloor(liquidity, C.TWO_BPS * absPriceDiff, denominator);
          deltaNext = FullMath.mulDivFloor(numerator, C.TWO_POW_96, sqrtPc).toInt256();
        }
      } else {
        // numerator = 2 * liquidity * absPriceDiff * sqrtPc
        // denominator = 2 * sqrtPc - sqrtPn * feeInBps / BPS
        unchecked {
          // overflow should not happen because the absPriceDiff is capped to ~5%
          denominator = C.TWO_BPS * sqrtPc - feeInBps * sqrtPn;
          numerator = FullMath.mulDivFloor(liquidity, C.TWO_BPS * absPriceDiff, denominator);
          deltaNext = FullMath.mulDivFloor(numerator, sqrtPc, C.TWO_POW_96).toInt256();
        }
      }
    } else {
      // we will perform negation as the last step
      // we round down so that we require less output qty to move ticks
      if (isToken0) {
        // numerator: (liquidity)(absPriceDiff)(2 * sqrtPc - fee * (sqrtPc + sqrtPn))
        // denominator: (sqrtPc * sqrtPn) * (2 * sqrtPc - fee * sqrtPn)
        unchecked {
          // overflow should not happen because the absPriceDiff is capped to ~5%
          denominator = C.TWO_BPS * sqrtPc - feeInBps * sqrtPn;
          numerator = denominator - feeInBps * sqrtPc;
          numerator = FullMath.mulDivFloor(liquidity << C.RES_96, numerator, denominator);
          deltaNext = (FullMath.mulDivFloor(numerator, absPriceDiff, sqrtPc) / sqrtPn).toInt256();
        }
      } else {
        // numerator: (liquidity)(absPriceDiff)(2 * sqrtPn - fee * (sqrtPn + sqrtPc))
        // denominator: (2 * sqrtPn - fee * sqrtPc)
        unchecked {
          // overflow should not happen because the absPriceDiff is capped to ~5%
          denominator = C.TWO_BPS * sqrtPn - feeInBps * sqrtPc;
          numerator = denominator - feeInBps * sqrtPn;
          numerator = FullMath.mulDivFloor(liquidity, numerator, denominator);
          deltaNext = FullMath.mulDivFloor(numerator, absPriceDiff, C.TWO_POW_96).toInt256();
        }
      }
      deltaNext = -deltaNext;
    }
  }

  function calcFinalSwapFeeAmount(
    uint256 absDelta,
    uint256 liquidity,
    uint160 sqrtPc,
    uint256 feeInBps,
    bool isExactInput,
    bool isToken0
  ) internal pure returns (uint256 lc) {
    if (isExactInput) {
      if (isToken0) {
        // lc = fee * absDelta * sqrtPc / 2
        lc = FullMath.mulDivFloor(sqrtPc, absDelta * feeInBps, C.TWO_BPS << C.RES_96);
      } else {
        // lc = fee * absDelta * / (sqrtPc * 2)
        lc = FullMath.mulDivFloor(C.TWO_POW_96, absDelta * feeInBps, C.TWO_BPS * sqrtPc);
      }
    } else {
      // obtain the smaller root of the quadratic equation
      // ax^2 - 2bx + c = 0 such that b > 0, and x denotes lc
      // we define the common terms that are used in both cases here
      uint256 a = feeInBps;
      uint256 b = (C.BPS - feeInBps) * liquidity;
      uint256 c = feeInBps * liquidity * absDelta;
      if (isToken0) {
        // solving fee * lc^2 - 2 * [(1 - fee) * liquidity - absDelta * sqrtPc] * lc + fee * liquidity * absDelta * sqrtPc = 0
        // multiply both sides by BPS to avoid the 'a' coefficient becoming 0
        // => feeInBps * lc^2 - 2 * [(BPS - feeInBps) * liquidity - BPS * absDelta * sqrtPc] * lc + feeInBps * liquidity * absDelta * sqrtPc = 0
        // a = feeInBps
        // b = (BPS - feeInBps) * liquidity - BPS * absDelta * sqrtPc
        // c = feeInBps * liquidity * absDelta * sqrtPc
        b -= FullMath.mulDivFloor(C.BPS * absDelta, sqrtPc, C.TWO_POW_96);
        c = FullMath.mulDivFloor(c, sqrtPc, C.TWO_POW_96);
      } else {
        // solving fee * sqrtPc * lc^2 - 2 * [(1 - fee) * liquidity * sqrtPc - absDelta] * lc + fee * liquidity * absDelta = 0
        // multiply both sides by BPS, divide by sqrtPc (since sqrtPc != 0)
        // => feeInBps * lc^2 - 2 * [(BPS - feeInBps) * liquidity - BPS * absDelta / sqrtPc] * lc + feeInBps * liquidity * absDelta / sqrtPc = 0
        // a = feeInBps
        // b = (BPS - feeInBps) * liquidity - BPS * absDelta / sqrtPc
        // c = liquidity * feeInBps * absDelta / sqrtPc
        b -= FullMath.mulDivFloor(C.BPS * absDelta, C.TWO_POW_96, sqrtPc);
        c = FullMath.mulDivFloor(c, C.TWO_POW_96, sqrtPc);
      }
      lc = QuadMath.getSmallerRootOfQuadEqn(a, b, c);
    }
  }

  function calcStepSwapFeeAmount(
    uint256 absDelta,
    uint256 liquidity,
    uint160 sqrtPc,
    uint160 sqrtPn,
    bool isExactInput,
    bool isToken0
  ) internal pure returns (uint256 lc) {
    if (isToken0) {
      // lc = sqrtPn * (liquidity / sqrtPc +/- absDelta)) - liquidity
      // needs to be minimum
      lc = FullMath.mulDivFloor(liquidity, C.TWO_POW_96, sqrtPc);
      lc = isExactInput ? lc + absDelta : lc - absDelta;
      lc = FullMath.mulDivFloor(sqrtPn, lc, C.TWO_POW_96) - liquidity;
    } else {
      // lc = (liquidity * sqrtPc +/- absDelta) / sqrtPn - liquidity
      // needs to be minimum
      lc = FullMath.mulDivFloor(liquidity, sqrtPc, C.TWO_POW_96);
      lc = isExactInput ? lc + absDelta : lc - absDelta;
      lc = FullMath.mulDivFloor(lc, C.TWO_POW_96, sqrtPn) - liquidity;
    }
  }

  function calcFinalPrice(
    uint256 absDelta,
    uint256 liquidity,
    uint256 lc,
    uint160 sqrtPc,
    bool isExactInput,
    bool isToken0
  ) internal pure returns (uint160 sqrtPn) {
    if (isToken0) {
      // round Up
      uint256 denominator = FullMath.mulDivFloor(absDelta, sqrtPc, C.TWO_POW_96);
      sqrtPn = (
        FullMath.mulDivCeiling(
          liquidity + lc,
          sqrtPc,
          isExactInput ? liquidity + denominator : liquidity - denominator
        )
      )
      .toUint160();
    } else {
      // round down
      uint256 tmp1 = FullMath.mulDivFloor(liquidity, sqrtPc, liquidity + lc);
      uint256 tmp2 = FullMath.mulDivFloor(absDelta, C.TWO_POW_96, liquidity + lc);
      sqrtPn = (isExactInput ? (tmp1 + tmp2) : (tmp1 - tmp2)).toUint160();
    }
  }

  // calculates actual output | input tokens in exchange for
  // user specified input | output
  // round down when calculating actual output (isExactInput) so we avoid sending too much
  // round up when calculating actual input (!isExactInput) so we get desired output amount
  function calcActualDelta(
    uint256 liquidity,
    uint160 sqrtPc,
    uint160 sqrtPn,
    uint256 lc,
    bool isExactInput,
    bool isToken0
  ) internal pure returns (int256 actualDelta) {
    if (isToken0) {
      // require difference in sqrtPc and sqrtPn > 0
      // so that we can properly do the multiplication of (liquidity)|sqrtPc - sqrtPn|
      // hence, if user specified
      // exact input: actualDelta = lc(sqrtPn) - [(liquidity)(sqrtPc - sqrtPn)]
      // exact output: actualDelta = lc(sqrtPn) + (liquidity)(sqrtPn - sqrtPc)

      if (isExactInput) {
        // minimise actual output (<0, make less negative) so we avoid sending too much
        // actualDelta = lc(sqrtPn) - [(liquidity)(sqrtPc - sqrtPn)]
        actualDelta =
          FullMath.mulDivCeiling(lc, sqrtPn, C.TWO_POW_96).toInt256() +
          FullMath.mulDivFloor(liquidity, sqrtPc - sqrtPn, C.TWO_POW_96).revToInt256();
      } else {
        // maximise actual input (>0) so we get desired output amount
        // actualDelta = lc(sqrtPn) + (liquidity)(sqrtPn - sqrtPc)
        actualDelta =
          FullMath.mulDivCeiling(lc, sqrtPn, C.TWO_POW_96).toInt256() +
          FullMath.mulDivCeiling(liquidity, sqrtPn - sqrtPc, C.TWO_POW_96).toInt256();
      }
    } else {
      // actualDelta = (liquidity + lc)/sqrtPn - (liquidity)/sqrtPc
      // if exactInput, minimise actual output (<0, make less negative) so we avoid sending too much
      // if exactOutput, maximise actual input (>0) so we get desired output amount
      actualDelta =
        FullMath.mulDivCeiling(liquidity + lc, C.TWO_POW_96, sqrtPn).toInt256() +
        FullMath.mulDivFloor(liquidity, C.TWO_POW_96, sqrtPc).revToInt256();
    }
  }
}
