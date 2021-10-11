// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

import {MathConstants as C} from './MathConstants.sol';
import {FullMath} from './FullMath.sol';
import {QuadMath} from './QuadMath.sol';
import {SafeCast} from './SafeCast.sol';

/// @title Contains helper functions for swaps
library SwapMath {
  using SafeCast for uint256;
  using SafeCast for int256;

  /// @dev compute the output data for the swap
  /// @param liquidity total of reinvest liquidity and base liquidity
  /// @param currentSqrtP the sqrt of current price
  /// @param targetSqrtP the sqrt of target price, if the swap reaches target price, the swap will stop
  /// @param feeInBps the deltaL of the swap
  /// @param specifiedAmount the amount of the swap
  /// @param isExactInput is specifiedAmount input or output?
  /// @param isToken0 is specifiedAmount token0 or token1?
  /// @return usedAmount the specified amount is used
  /// @return returnedAmount the opposite amount of usedAmount
  /// @return deltaL the deltaL for this swap - also the increment of reinvestLiquidity
  /// @return nextSqrtP the price after swapping
  function computeSwapStep(
    uint256 liquidity,
    uint160 currentSqrtP,
    uint160 targetSqrtP,
    uint256 feeInBps,
    int256 specifiedAmount,
    bool isExactInput,
    bool isToken0
  )
    internal
    pure
    returns (
      int256 usedAmount,
      int256 returnedAmount,
      uint256 deltaL,
      uint160 nextSqrtP
    )
  {
    // in the event currentSqrtP == targetSqrtP because of tick movements, return
    // eg. swapped up tick where specified price limit is on an initialised tick
    // then swapping down tick will cause next tick to be the same as the current tick
    if (currentSqrtP == targetSqrtP) return (0, 0, 0, currentSqrtP);
    usedAmount = calcReachAmount(
      liquidity,
      currentSqrtP,
      targetSqrtP,
      feeInBps,
      isExactInput,
      isToken0
    );

    if (
      (isExactInput && usedAmount >= specifiedAmount) ||
      (!isExactInput && usedAmount <= specifiedAmount)
    ) {
      usedAmount = specifiedAmount;
    } else {
      nextSqrtP = targetSqrtP;
    }

    uint256 absDelta = usedAmount >= 0 ? uint256(usedAmount) : usedAmount.revToUint256();
    if (nextSqrtP == 0) {
      deltaL = estimateIncrementalLiquidity(
        absDelta,
        liquidity,
        currentSqrtP,
        feeInBps,
        isExactInput,
        isToken0
      );
      nextSqrtP = calcFinalPrice(absDelta, liquidity, deltaL, currentSqrtP, isExactInput, isToken0)
      .toUint160();
    } else {
      deltaL = calcIncrementalLiquidity(
        absDelta,
        liquidity,
        currentSqrtP,
        nextSqrtP,
        isExactInput,
        isToken0
      );
    }
    returnedAmount = calcReturnedAmount(
      liquidity,
      currentSqrtP,
      nextSqrtP,
      deltaL,
      isExactInput,
      isToken0
    );
  }

  /// @dev calculates the amount needed to reach targetSqrtP from currentSqrtP
  /// @dev we cast currentSqrtP and targetSqrtP to uint256 as they are multiplied by TWO_BPS or feeInBps,
  function calcReachAmount(
    uint256 liquidity,
    uint256 currentSqrtP,
    uint256 targetSqrtP,
    uint256 feeInBps,
    bool isExactInput,
    bool isToken0
  ) internal pure returns (int256 reachAmount) {
    uint256 absPriceDiff;
    unchecked {
      absPriceDiff = (currentSqrtP >= targetSqrtP)
        ? (currentSqrtP - targetSqrtP)
        : (targetSqrtP - currentSqrtP);
    }
    if (isExactInput) {
      // we round down so that we avoid taking giving away too much for the specified input
      // ie. require less input qty to move ticks
      if (isToken0) {
        // numerator = 2 * liquidity * absPriceDiff
        // denominator = currentSqrtP * (2 * targetSqrtP - currentSqrtP * feeInBps / BPS)
        // overflow should not happen because the absPriceDiff is capped to ~5%
        uint256 denominator = C.TWO_BPS * targetSqrtP - feeInBps * currentSqrtP;
        uint256 numerator = FullMath.mulDivFloor(liquidity, C.TWO_BPS * absPriceDiff, denominator);
        reachAmount = FullMath.mulDivFloor(numerator, C.TWO_POW_96, currentSqrtP).toInt256();
      } else {
        // numerator = 2 * liquidity * absPriceDiff * currentSqrtP
        // denominator = 2 * currentSqrtP - targetSqrtP * feeInBps / BPS
        // overflow should not happen because the absPriceDiff is capped to ~5%
        uint256 denominator = C.TWO_BPS * currentSqrtP - feeInBps * targetSqrtP;
        uint256 numerator = FullMath.mulDivFloor(liquidity, C.TWO_BPS * absPriceDiff, denominator);
        reachAmount = FullMath.mulDivFloor(numerator, currentSqrtP, C.TWO_POW_96).toInt256();
      }
    } else {
      // we will perform negation as the last step
      // we round down so that we require less output qty to move ticks
      if (isToken0) {
        // numerator: (liquidity)(absPriceDiff)(2 * currentSqrtP - deltaL * (currentSqrtP + targetSqrtP))
        // denominator: (currentSqrtP * targetSqrtP) * (2 * currentSqrtP - deltaL * targetSqrtP)
        // overflow should not happen because the absPriceDiff is capped to ~5%
        uint256 denominator = C.TWO_BPS * currentSqrtP - feeInBps * targetSqrtP;
        uint256 numerator = denominator - feeInBps * currentSqrtP;
        numerator = FullMath.mulDivFloor(liquidity << C.RES_96, numerator, denominator);
        reachAmount = (FullMath.mulDivFloor(numerator, absPriceDiff, currentSqrtP) / targetSqrtP)
        .revToInt256();
      } else {
        // numerator: liquidity * absPriceDiff * (TWO_BPS * targetSqrtP - feeInBps * (targetSqrtP + currentSqrtP))
        // denominator: (TWO_BPS * targetSqrtP - feeInBps * currentSqrtP)
        // overflow should not happen because the absPriceDiff is capped to ~5%
        uint256 denominator = C.TWO_BPS * targetSqrtP - feeInBps * currentSqrtP;
        uint256 numerator = denominator - feeInBps * targetSqrtP;
        numerator = FullMath.mulDivFloor(liquidity, numerator, denominator);
        reachAmount = FullMath.mulDivFloor(numerator, absPriceDiff, C.TWO_POW_96).revToInt256();
      }
    }
  }

  /// @dev estimate deltaL base on amountSpecified
  function estimateIncrementalLiquidity(
    uint256 absDelta,
    uint256 liquidity,
    uint160 currentSqrtP,
    uint256 feeInBps,
    bool isExactInput,
    bool isToken0
  ) internal pure returns (uint256 deltaL) {
    if (isExactInput) {
      if (isToken0) {
        // deltaL = feeInBps * absDelta * currentSqrtP / 2
        deltaL = FullMath.mulDivFloor(currentSqrtP, absDelta * feeInBps, C.TWO_BPS << C.RES_96);
      } else {
        // deltaL = feeInBps * absDelta * / (currentSqrtP * 2)
        // Because nextSqrtP = (liquidity + absDelta / currentSqrtP) * currentSqrtP / (liquidity + deltaL)
        // so we round up deltaL, to round down nextSqrtP
        deltaL = FullMath.mulDivCeiling(
          C.TWO_POW_96,
          absDelta * feeInBps,
          C.TWO_BPS * currentSqrtP
        );
      }
    } else {
      // obtain the smaller root of the quadratic equation
      // ax^2 - 2bx + c = 0 such that b > 0, and x denotes deltaL
      uint256 a = feeInBps;
      uint256 b = (C.BPS - feeInBps) * liquidity;
      uint256 c = feeInBps * liquidity * absDelta;
      if (isToken0) {
        // a = feeInBps
        // b = (BPS - feeInBps) * liquidity - BPS * absDelta * currentSqrtP
        // c = feeInBps * liquidity * absDelta * currentSqrtP
        b -= FullMath.mulDivFloor(C.BPS * absDelta, currentSqrtP, C.TWO_POW_96);
        c = FullMath.mulDivFloor(c, currentSqrtP, C.TWO_POW_96);
      } else {
        // a = feeInBps
        // b = (BPS - feeInBps) * liquidity - BPS * absDelta / currentSqrtP
        // c = liquidity * feeInBps * absDelta / currentSqrtP
        b -= FullMath.mulDivFloor(C.BPS * absDelta, C.TWO_POW_96, currentSqrtP);
        c = FullMath.mulDivFloor(c, C.TWO_POW_96, currentSqrtP);
      }
      deltaL = QuadMath.getSmallerRootOfQuadEqn(a, b, c);
    }
  }

  /// @dev from currentLiquidity, specifiedAmount, current and next Price calculate deltaL
  function calcIncrementalLiquidity(
    uint256 absDelta,
    uint256 liquidity,
    uint160 currentSqrtP,
    uint160 nextSqrtP,
    bool isExactInput,
    bool isToken0
  ) internal pure returns (uint256 deltaL) {
    if (isToken0) {
      // deltaL = nextSqrtP * (liquidity / currentSqrtP +/- absDelta)) - liquidity
      // needs to be minimum
      uint256 tmp1 = FullMath.mulDivFloor(liquidity, C.TWO_POW_96, currentSqrtP);
      uint256 tmp2 = isExactInput ? tmp1 + absDelta : tmp1 - absDelta;
      uint256 tmp3 = FullMath.mulDivFloor(nextSqrtP, tmp2, C.TWO_POW_96);
      // in edge cases where liquidity or absDelta is small
      // liquidity might be greater than nextSqrtP * ((liquidity / currentSqrtP) +/- absDelta))
      // due to rounding
      deltaL = (tmp3 > liquidity) ? tmp3 - liquidity : 0;
    } else {
      // deltaL = (liquidity * currentSqrtP +/- absDelta) / nextSqrtP - liquidity
      // needs to be minimum
      uint256 tmp1 = FullMath.mulDivFloor(liquidity, currentSqrtP, C.TWO_POW_96);
      uint256 tmp2 = isExactInput ? tmp1 + absDelta : tmp1 - absDelta;
      uint256 tmp3 = FullMath.mulDivFloor(tmp2, C.TWO_POW_96, nextSqrtP);
      // in edge cases where liquidity or absDelta is small
      // liquidity might be greater than nextSqrtP * ((liquidity / currentSqrtP) +/- absDelta))
      // due to rounding
      deltaL = (tmp3 > liquidity) ? tmp3 - liquidity : 0;
    }
  }

  function calcFinalPrice(
    uint256 absDelta,
    uint256 liquidity,
    uint256 deltaL,
    uint160 currentSqrtP,
    bool isExactInput,
    bool isToken0
  ) internal pure returns (uint256) {
    if (isToken0) {
      // if isExactInput: swap 0 -> 1, sqrtP decreases, we round up
      // else swap: 1 -> 0, sqrtP increases, we round down
      uint256 tmp = FullMath.mulDivFloor(absDelta, currentSqrtP, C.TWO_POW_96);
      if (isExactInput) {
        return FullMath.mulDivCeiling(liquidity + deltaL, currentSqrtP, liquidity + tmp);
      } else {
        return FullMath.mulDivFloor(liquidity + deltaL, currentSqrtP, liquidity - tmp);
      }
    } else {
      // if isExactInput: swap 1 -> 0, sqrtP increases, we round down
      // else swap: 0 -> 1, sqrtP decreases, we round up
      if (isExactInput) {
        uint256 tmp = FullMath.mulDivCeiling(absDelta, C.TWO_POW_96, currentSqrtP);
        return FullMath.mulDivFloor(liquidity + tmp, currentSqrtP, liquidity + deltaL);
      } else {
        uint256 tmp = FullMath.mulDivFloor(absDelta, C.TWO_POW_96, currentSqrtP);
        return FullMath.mulDivCeiling(liquidity - tmp, currentSqrtP, liquidity + deltaL);
      }
    }
  }

  /// @dev calculates returned output | input tokens in exchange for specified amount
  /// @dev round down when calculating returned output (isExactInput) so we avoid sending too much
  /// @dev round up when calculating returned input (!isExactInput) so we get desired output amount
  function calcReturnedAmount(
    uint256 liquidity,
    uint160 currentSqrtP,
    uint160 nextSqrtP,
    uint256 deltaL,
    bool isExactInput,
    bool isToken0
  ) internal pure returns (int256 returnedAmount) {
    if (isToken0) {
      if (isExactInput) {
        // minimise actual output (<0, make less negative) so we avoid sending too much
        // returnedAmount = deltaL * nextSqrtP - liquidity * (currentSqrtP - nextSqrtP)
        returnedAmount =
          FullMath.mulDivCeiling(deltaL, nextSqrtP, C.TWO_POW_96).toInt256() +
          FullMath.mulDivFloor(liquidity, currentSqrtP - nextSqrtP, C.TWO_POW_96).revToInt256();
      } else {
        // maximise actual input (>0) so we get desired output amount
        // returnedAmount = deltaL * nextSqrtP + liquidity * (nextSqrtP - currentSqrtP)
        returnedAmount =
          FullMath.mulDivCeiling(deltaL, nextSqrtP, C.TWO_POW_96).toInt256() +
          FullMath.mulDivCeiling(liquidity, nextSqrtP - currentSqrtP, C.TWO_POW_96).toInt256();
      }
    } else {
      // returnedAmount = (liquidity + deltaL)/nextSqrtP - (liquidity)/currentSqrtP
      // if exactInput, minimise actual output (<0, make less negative) so we avoid sending too much
      // if exactOutput, maximise actual input (>0) so we get desired output amount
      returnedAmount =
        FullMath.mulDivCeiling(liquidity + deltaL, C.TWO_POW_96, nextSqrtP).toInt256() +
        FullMath.mulDivFloor(liquidity, C.TWO_POW_96, currentSqrtP).revToInt256();
    }

    if (isExactInput && returnedAmount == 1) {
      // rounding make returnedAmount == 1
      returnedAmount = 0;
    }
  }
}
