// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.4;

import '../periphery/base/LiquidityHelper.sol';
import '../periphery/base/ImmutableRouterStorage.sol';
import '../periphery/base/Multicall.sol';


contract MockLiquidityHelper is LiquidityHelper, Multicall {

  constructor(address _factory, address _WETH) ImmutableRouterStorage(_factory, _WETH) {}

  function testUnlockPool(address token0, address token1, uint16 fee, uint160 initPrice) external payable {
    unlockPool(token0, token1, fee, initPrice);
  }

  function testAddLiquidity(AddLiquidityParams memory params)
    external payable
    returns (
      uint128 liquidity,
      uint256 amount0,
      uint256 amount1,
      IProAMMPool pool
    ) {
    return addLiquidity(params);
  }
}
