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
    bool isToken0 = isExactInput ? (currentSqrtP > targetSqrtP) : (currentSqrtP < targetSqrtP);
    require(currentSqrtP * 95 < targetSqrtP * 100 && targetSqrtP * 100 < currentSqrtP * 105);
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
      if (isExactInput) {
        if (nextSqrtP > targetSqrtP) {
          int256 revDelta = SwapMath.calcActualDelta(
            liquidity,
            currentSqrtP,
            targetSqrtP,
            fee,
            false,
            true
          );
          isTrue(revDelta > 0);
          isTrue(absDelta >= uint256(revDelta));
        }
      } else {
        isTrue(nextSqrtP <= targetSqrtP);
      }
    }
  }
}
