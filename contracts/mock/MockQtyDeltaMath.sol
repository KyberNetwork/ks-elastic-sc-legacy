// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.5;

import '../libraries/QtyDeltaMath.sol';

contract MockQtyDeltaMath {
  function getQty0Delta(
    uint160 sqrtPriceA,
    uint160 sqrtPriceB,
    int128 liquidity
  ) external pure returns (int256) {
    return QtyDeltaMath.getQty0Delta(sqrtPriceA, sqrtPriceB, liquidity);
  }

  function getQty1Delta(
    uint160 sqrtPriceA,
    uint160 sqrtPriceB,
    int128 liquidity
  ) external pure returns (int256) {
    return QtyDeltaMath.getQty1Delta(sqrtPriceA, sqrtPriceB, liquidity);
  }

  function getQtyFromBurnRTokens(uint160 sqrtPrice, uint256 lfDelta)
    external
    pure
    returns (uint256 qty0, uint256 qty1)
  {
    qty0 = QtyDeltaMath.getQty0FromBurnRTokens(sqrtPrice, lfDelta);
    qty1 = QtyDeltaMath.getQty1FromBurnRTokens(sqrtPrice, lfDelta);
  }
}
