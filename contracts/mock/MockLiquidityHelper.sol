// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.4;

import '../periphery/base/LiquidityHelper.sol';
import '../periphery/base/Multicall.sol';

contract MockLiquidityHelper is LiquidityHelper, Multicall {
  constructor(address _factory, address _WETH) LiquidityHelper(_factory, _WETH) {}

  function testUnlockPool(
    address token0,
    address token1,
    uint16 fee,
    uint160 initialSqrtP
  ) external payable returns (IPool pool) {
    pool = _getPool(token0, token1, fee);
    if (token0 < token1) {
      pool.unlockPool(initialSqrtP, _callbackData(token0, token1, fee));
    } else {
      pool.unlockPool(initialSqrtP, _callbackData(token1, token0, fee));
    }
  }

  function testAddLiquidity(AddLiquidityParams memory params)
    external
    payable
    returns (
      uint128 liquidity,
      uint256 amount0,
      uint256 amount1,
      uint256 feeGrowthInsideLast,
      IPool pool
    )
  {
    return _addLiquidity(params);
  }
}
