// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

import {MathConstants as C} from './MathConstants.sol';
import {FullMath} from './FullMath.sol';
import {SafeCast} from './SafeCast.sol';


library LiquidityMath {
  using SafeCast for uint256;

  /// @notice Gets liquidity from qty 0 and the price range
  /// qty0 = liquidity * (sqrt(upper) - sqrt(lower)) / (sqrt(upper) * sqrt(lower))
  /// => liquidity = qty0 * (sqrt(upper) * sqrt(lower)) / (sqrt(upper) - sqrt(lower))
  /// @param sqrtPriceA A sqrt price
  /// @param sqrtPriceB Another sqrt price
  /// @param qty0 amount of token0
  /// @return liquidity amount of returned liquidity to not exceed the qty0
  function getLiquidityFromQty0(
    uint160 sqrtPriceA,
    uint160 sqrtPriceB,
    uint256 qty0
  ) internal pure returns (uint128) {
    if (sqrtPriceA > sqrtPriceB) (sqrtPriceA, sqrtPriceB) = (sqrtPriceB, sqrtPriceA);

    uint256 liq = FullMath.mulDivFloor(sqrtPriceA, sqrtPriceB, C.TWO_POW_96);
    unchecked {
      return FullMath.mulDivFloor(liq, qty0, sqrtPriceB - sqrtPriceA).toUint128();
    }
  }

  /// @notice Gets liquidity from qty 1 and the price range
  /// @dev qty1 = liquidity * (sqrt(upper) - sqrt(lower))
  ///   thus, liquidity = qty1 / (sqrt(upper) - sqrt(lower))
  /// @param sqrtPriceA A sqrt price
  /// @param sqrtPriceB Another sqrt price
  /// @param qty1 amount of token1
  /// @return liquidity amount of returned liquidity to not exceed to qty1
  function getLiquidityFromQty1(
    uint160 sqrtPriceA,
    uint160 sqrtPriceB,
    uint256 qty1
  ) internal pure returns (uint128) {
    if (sqrtPriceA > sqrtPriceB) (sqrtPriceA, sqrtPriceB) = (sqrtPriceB, sqrtPriceA);

    unchecked {
      return FullMath.mulDivFloor(qty1, C.TWO_POW_96, sqrtPriceB - sqrtPriceA).toUint128();
    }
  }

  /// @notice Gets liquidity given price range and 2 qties of token0 and token1
  /// @param sqrtPriceCurrent current price
  /// @param sqrtPriceA A sqrt price
  /// @param sqrtPriceB Another sqrt price
  /// @param qty0 amount of token0 - at most
  /// @param qty1 amount of token1 - at most
  /// @return liquidity amount of returned liquidity to not exceed the given qties
  function getLiquidityFromQties(
    uint160 sqrtPriceCurrent,
    uint160 sqrtPriceA,
    uint160 sqrtPriceB,
    uint256 qty0,
    uint256 qty1
  ) internal pure returns (uint128) {
    if (sqrtPriceA > sqrtPriceB) (sqrtPriceA, sqrtPriceB) = (sqrtPriceB, sqrtPriceA);

    if (sqrtPriceCurrent <= sqrtPriceA) {
      return getLiquidityFromQty0(sqrtPriceA, sqrtPriceB, qty0);
    }
    if (sqrtPriceCurrent >= sqrtPriceB) {
      return getLiquidityFromQty1(sqrtPriceA, sqrtPriceB, qty1);
    }
    uint128 liq0 = getLiquidityFromQty0(sqrtPriceCurrent, sqrtPriceB, qty0);
    uint128 liq1 = getLiquidityFromQty1(sqrtPriceA, sqrtPriceCurrent, qty1);
    return liq0 < liq1 ? liq0 : liq1;
  }
}
