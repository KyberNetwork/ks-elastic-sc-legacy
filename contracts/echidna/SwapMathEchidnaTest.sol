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
    uint8 feeInBps
  ) external {
    bool isToken0 = currentSqrtP > targetSqrtP;
    if (isToken0) {
      require(currentSqrtP * 95 < targetSqrtP * 100);
    } else {
      require(currentSqrtP * 100 > targetSqrtP * 95);
    }
    int256 deltaNext = SwapMath.calcDeltaNext(
      liquidity,
      currentSqrtP,
      targetSqrtP,
      feeInBps,
      true,
      isToken0
    );
    isTrue(deltaNext >= 0);

    uint256 absDelta = uint256(deltaNext) - 1;

    uint256 fee = SwapMath.calcFinalSwapFeeAmount(
      absDelta,
      liquidity,
      currentSqrtP,
      feeInBps,
      true,
      isToken0
    );
    uint256 nextSqrtP = SwapMath.calcFinalPrice(
      absDelta,
      liquidity,
      fee,
      currentSqrtP,
      true,
      isToken0
    );
    if (isToken0) {
      isTrue(nextSqrtP >= targetSqrtP);
    } else {
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
    }
  }
}
