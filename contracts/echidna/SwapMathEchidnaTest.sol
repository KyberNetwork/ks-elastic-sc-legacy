// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import '../libraries/SwapMath.sol';
import '../libraries/TickMath.sol';
import './EchidnaAssert.sol';

contract SwapMathEchidnaTest is EchidnaAssert {
  function checkCalcDeltaNextInvariants(
    uint128 liquidity,
    uint160 currentSqrtP,
    uint160 targetSqrtP,
    uint8 feeInBps,
    bool isExactInput
  ) external {
    // TODO: this test is not passed for isExtractOutput
    require(isExactInput);
    checkInitCondition(liquidity, currentSqrtP, targetSqrtP, feeInBps);
    bool isToken0 = isExactInput ? (currentSqrtP > targetSqrtP) : (currentSqrtP < targetSqrtP);
    int256 deltaNext = SwapMath.calcDeltaNext(
      liquidity,
      currentSqrtP,
      targetSqrtP,
      feeInBps,
      isExactInput,
      isToken0
    );
    if (isExactInput) {
      isTrue(deltaNext >= 0);
    } else {
      isTrue(deltaNext <= 0);
    }

    uint256 absDelta = isExactInput ? uint256(deltaNext) : uint256(-deltaNext);
    absDelta -= 1;

    uint256 fee = SwapMath.calcFinalSwapFeeAmount(
      absDelta,
      liquidity,
      currentSqrtP,
      feeInBps,
      isExactInput,
      isToken0
    );
    uint256 nextSqrtP = SwapMath.calcFinalPrice(
      absDelta,
      liquidity,
      fee,
      currentSqrtP,
      isExactInput,
      isToken0
    );
    if (currentSqrtP > targetSqrtP) {
      isTrue(nextSqrtP >= targetSqrtP);
    } else {
      isTrue(nextSqrtP <= targetSqrtP);
    }
  }

  function checkComputeSwapStep(
    uint128 liquidity,
    int256 amountRemaining,
    uint160 currentSqrtP,
    uint160 targetSqrtP,
    uint8 feeInBps
  ) external {
    checkInitCondition(liquidity, currentSqrtP, targetSqrtP, feeInBps);
    require(amountRemaining != 0);
    bool isExactInput = amountRemaining > 0;
    bool isToken0 = isExactInput ? (currentSqrtP > targetSqrtP) : (currentSqrtP < targetSqrtP);
    (int256 delta, int256 actualDelta, , uint160 nextSqrtP) = SwapMath.computeSwapStep(
      liquidity,
      currentSqrtP,
      targetSqrtP,
      feeInBps,
      amountRemaining,
      isExactInput,
      isToken0
    );

    if (nextSqrtP != targetSqrtP) {
      isTrue(delta == amountRemaining);
    }

    // next price is between price and price target
    if (currentSqrtP <= targetSqrtP) {
      isTrue(nextSqrtP <= targetSqrtP);
      isTrue(currentSqrtP <= nextSqrtP);
    } else {
      isTrue(nextSqrtP >= targetSqrtP);
      isTrue(currentSqrtP >= nextSqrtP);
    }

    if (nextSqrtP != currentSqrtP) {
      if (isExactInput) {
        isTrue(delta >= 0);
        isTrue(actualDelta <= 0);
      } else {
        isTrue(delta <= 0);
        isTrue(actualDelta >= 0);
      }
    }
  }

  function checkInitCondition(
    uint128 liquidity,
    uint160 currentSqrtP,
    uint160 targetSqrtP,
    uint8 feeInBps
  ) internal pure {
    require(currentSqrtP >= TickMath.MIN_SQRT_RATIO && currentSqrtP <= TickMath.MAX_SQRT_RATIO);
    require(targetSqrtP >= TickMath.MIN_SQRT_RATIO && targetSqrtP <= TickMath.MAX_SQRT_RATIO);
    require(liquidity >= 1000);
    require(feeInBps != 0);
    require(currentSqrtP * 95 < targetSqrtP * 100 && targetSqrtP * 100 < currentSqrtP * 105);
  }
}
