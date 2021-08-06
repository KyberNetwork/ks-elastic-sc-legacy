// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

import '../libraries/SwapMath.sol';

contract MockSwapMath {
  function calcDeltaNext(
    uint256 lpPluslf,
    uint160 sqrtPc,
    uint160 sqrtPn,
    uint16 feeInBps,
    bool isExactInput,
    bool isToken0
  ) external pure returns (int256) {
    return SwapMath.calcDeltaNext(lpPluslf, sqrtPc, sqrtPn, feeInBps, isExactInput, isToken0);
  }

  function calcFinalPrice(
    uint256 absDelta,
    uint256 lpPluslf,
    uint256 lc,
    uint160 sqrtPc,
    bool isToken0
  ) external pure returns (uint256) {
    return SwapMath.calcFinalPrice(absDelta, lpPluslf, lc, sqrtPc, isToken0);
  }

  function calcSwapFeeAmounts(
    uint256 absDelta,
    uint160 sqrtPc,
    uint16 swapFeeBps,
    bool isExactInput,
    bool isToken0
  ) external pure returns (uint256) {
    return SwapMath.calcSwapFeeAmounts(absDelta, sqrtPc, swapFeeBps, isExactInput, isToken0);
  }

  function calcActualDelta(
    uint256 lpPluslf,
    uint160 sqrtPc,
    uint160 sqrtPn,
    uint128 lc,
    bool isExactInput,
    bool isToken0
  ) external pure returns (int256) {
    return SwapMath.calcActualDelta(lpPluslf, sqrtPc, sqrtPn, lc, isExactInput, isToken0);
  }
}
