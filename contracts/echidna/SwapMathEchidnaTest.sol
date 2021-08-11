// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import '../libraries/SwapMath.sol';
import './EchidnaAssert.sol';

/// @dev this contract must be compiled by sol 7 because echidna is not compatible with sol 8
contract SwapMathEchidnaTest is EchidnaAssert {
  function checkCalcDeltaNextInvariants(
    uint256 liquidity,
    uint160 currentSqrtP,
    uint160 targetSqrtP,
    uint8 feeInBps
  ) external {
    bool isToken0 = currentSqrtP > targetSqrtP;
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

    uint256 fee = SwapMath.calcSwapFeeAmounts(absDelta, currentSqrtP, feeInBps, true, isToken0);
    uint256 nextSqrtP = SwapMath.calcFinalPrice(
      absDelta,
      liquidity,
      fee,
      currentSqrtP,
      true,
      isToken0
    );
    if (isToken0) {
      isTrue(nextSqrtP > targetSqrtP);
    } else {
      isTrue(nextSqrtP < targetSqrtP);
    }
  }
}
