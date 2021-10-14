// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

/// @title Contains helper function to add int128 liquidityDelta to uint128 liquidity
library LiqDeltaMath {
  function applyLiquidityDelta(
    uint128 liquidity,
    uint128 liquidityDelta,
    bool isAdd
  ) internal pure returns (uint128) {
    return isAdd ? liquidity + liquidityDelta : liquidity - liquidityDelta;
  }
}
