// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

import {SafeCast} from './SafeCast.sol';

/// @title Contains helper function to add int128 liquidityDelta to uint128 liquidity
library LiqDeltaMath {
  using SafeCast for int128;

  // TODO: consider to convert into changeLiquidity(uint128 liquidity, uint128 liquidityDelta, bool isAdd)
  // noice that uniswap v3 has cast uint128 to int128 and back into uint128
  // https://github.com/Uniswap/uniswap-v3-core/blob/7d15bc427756b8cf1874d2ddc667d40592a01b4c/contracts/UniswapV3Pool.sol#L471
  function addLiquidityDelta(uint128 liquidity, int128 liquidityDelta)
    internal
    pure
    returns (uint128)
  {
    return
      (liquidityDelta >= 0)
        ? liquidity + uint128(liquidityDelta)
        : liquidity - (type(uint128).max - uint128(liquidityDelta) + 1);
  }
}
