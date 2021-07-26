// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

import '../libraries/LiqDeltaMath.sol';

contract MockLiqDeltaMath {
  function addLiquidityDelta(uint128 liquidity, int128 liquidityDelta)
    external
    pure
    returns (uint256)
  {
    return LiqDeltaMath.addLiquidityDelta(liquidity, liquidityDelta);
  }
}
