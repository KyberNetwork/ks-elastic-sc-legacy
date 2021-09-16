// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

import '../libraries/LiquidityMath.sol';

contract MockLiquidityMath {
  function getLiquidityFromQty0(
    uint160 sqrtPriceA,
    uint160 sqrtPriceB,
    uint256 qty0
  ) external pure returns (uint128) {
    return LiquidityMath.getLiquidityFromQty0(sqrtPriceA, sqrtPriceB, qty0);
  }

  function getLiquidityFromQty1(
    uint160 sqrtPriceA,
    uint160 sqrtPriceB,
    uint256 qty1
  ) external pure returns (uint128) {
    return LiquidityMath.getLiquidityFromQty1(sqrtPriceA, sqrtPriceB, qty1);
  }

  function getLiquidityFromQties(
    uint160 sqrtPriceCurrent,
    uint160 sqrtPriceA,
    uint160 sqrtPriceB,
    uint256 qty0,
    uint256 qty1
  ) external pure returns (uint128) {
    return LiquidityMath.getLiquidityFromQties(sqrtPriceCurrent, sqrtPriceA, sqrtPriceB, qty0, qty1);
  }
}
