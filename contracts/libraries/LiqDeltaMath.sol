// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

import {SafeCast} from './SafeCast.sol';

/// @title Contains helper function to add int128 liquidityDelta to uint128 liquidity
library LiqDeltaMath {
  using SafeCast for int128;

  function addLiquidityDelta(uint128 liquidity, int128 liquidityDelta)
    internal
    pure
    returns (uint128)
  {
    if (liquidityDelta >= 0) {
      return liquidity + uint128(liquidityDelta);
    } else {
      return liquidity - liquidityDelta.revToUint128();
    }
  }
}
