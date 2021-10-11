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
    bool isExactInput,
    bool isToken0
  ) external pure returns (uint256) {
    return SwapMath.calcFinalPrice(absDelta, lpPluslf, lc, sqrtPc, isExactInput, isToken0);
  }

  function calcFinalSwapFeeAmount(
    uint256 absDelta,
    uint256 liquidity,
    uint160 sqrtPc,
    uint16 feeInBps,
    bool isExactInput,
    bool isToken0
  ) external pure returns (uint256) {
    return
      SwapMath.calcFinalSwapFeeAmount(
        absDelta,
        liquidity,
        sqrtPc,
        feeInBps,
        isExactInput,
        isToken0
      );
  }

  function calcStepSwapFeeAmount(
    uint256 absDelta,
    uint256 liquidity,
    uint160 currentSqrtP,
    uint160 targetSqrtP,
    bool isExactInput,
    bool isToken0
  ) external pure returns (uint256 rLiquidity) {
    rLiquidity = SwapMath.calcStepSwapFeeAmount(
      absDelta,
      liquidity,
      currentSqrtP,
      targetSqrtP,
      isExactInput,
      isToken0
    );
  }

  function calcActualDelta(
    uint256 liquidity,
    uint160 currentSqrtP,
    uint160 targetSqrtP,
    uint128 rLiquidity,
    bool isExactInput,
    bool isToken0
  ) external pure returns (int256 actualDelta) {
    actualDelta = SwapMath.calcActualDelta(
      liquidity,
      currentSqrtP,
      targetSqrtP,
      rLiquidity,
      isExactInput,
      isToken0
    );
  }

  function computeSwapStep(
    uint256 liquidity,
    uint160 currentSqrtP,
    uint160 targetSqrtP,
    uint256 feeInBps,
    int256 qtyRemaining,
    bool isExactInput,
    bool isToken0
  )
    external
    view
    returns (
      int256 delta,
      int256 actualDelta,
      uint256 fee,
      uint160 nextSqrtP,
      uint256 gasCost
    )
  {
    uint256 start = gasleft();
    (delta, actualDelta, fee, nextSqrtP) = SwapMath.computeSwapStep(
      liquidity,
      currentSqrtP,
      targetSqrtP,
      feeInBps,
      qtyRemaining,
      isExactInput,
      isToken0
    );
    gasCost = start - gasleft();
  }
}
