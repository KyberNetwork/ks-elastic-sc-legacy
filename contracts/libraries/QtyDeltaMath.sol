// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

import {MathConstants} from './MathConstants.sol';
import {FullMath} from './FullMath.sol';
import {SafeCast} from './SafeCast.sol';

/// @title Contains helper functions for calculating
/// token0 and token1 quantites from differences in prices
/// or from burning reinvestment tokens
library QtyDeltaMath {
  using SafeCast for uint256;

  /// @notice Gets the qty0 delta between two prices
  /// @dev Calculates liquidity / sqrt(lower) - liquidity / sqrt(upper),
  /// i.e. liquidity * (sqrt(upper) - sqrt(lower)) / (sqrt(upper) * sqrt(lower))
  /// @param sqrtPriceA A sqrt price
  /// @param sqrtPriceB Another sqrt price
  /// @param liquidity Usable liquidity quantity
  /// @param roundUp Whether to round the result up or down
  /// @return token0 qty needed to cover a position of size liquidity between the 2 sqrt prices
  function getQty0Delta(
    uint160 sqrtPriceA,
    uint160 sqrtPriceB,
    uint128 liquidity,
    bool roundUp
  ) internal pure returns (uint256) {
    if (sqrtPriceA > sqrtPriceB) (sqrtPriceA, sqrtPriceB) = (sqrtPriceB, sqrtPriceA);

    uint256 numerator1 = uint256(liquidity) << MathConstants.RES_96;
    uint256 numerator2 = sqrtPriceB - sqrtPriceA;

    require(sqrtPriceA > 0, '0 sqrtPrice');

    return
      roundUp
        ? divCeiling(FullMath.mulDivCeiling(numerator1, numerator2, sqrtPriceB), sqrtPriceA)
        : FullMath.mulDivFloor(numerator1, numerator2, sqrtPriceB) / sqrtPriceA;
  }

  /// @notice Gets the token1 delta quantity between two prices
  /// @dev Calculates liquidity * (sqrt(upper) - sqrt(lower))
  /// @param sqrtPriceA A sqrt price
  /// @param sqrtPriceB Another sqrt price
  /// @param liquidity Usable liquidity quantity
  /// @param roundUp Whether to round the result up or down
  /// @return token1 qty needed to cover a position of size liquidity between the 2 sqrt prices
  function getQty1Delta(
    uint160 sqrtPriceA,
    uint160 sqrtPriceB,
    uint128 liquidity,
    bool roundUp
  ) internal pure returns (uint256) {
    if (sqrtPriceA > sqrtPriceB) (sqrtPriceA, sqrtPriceB) = (sqrtPriceB, sqrtPriceA);

    return
      roundUp
        ? FullMath.mulDivCeiling(liquidity, sqrtPriceB - sqrtPriceA, MathConstants.TWO_POW_96)
        : FullMath.mulDivFloor(liquidity, sqrtPriceB - sqrtPriceA, MathConstants.TWO_POW_96);
  }

  /// @notice Helper that gets signed token0 delta
  /// @param sqrtPriceA A sqrt price
  /// @param sqrtPriceB Another sqrt price
  /// @param liquidity Liquidity delta for which to compute the token0 delta
  /// @return token0 quantity corresponding to the passed liquidityDelta between the two prices
  function getQty0Delta(
    uint160 sqrtPriceA,
    uint160 sqrtPriceB,
    int128 liquidity
  ) internal pure returns (int256) {
    return
      (liquidity < 0)
        ? (type(uint256).max -
          getQty0Delta(sqrtPriceA, sqrtPriceB, type(uint128).max - uint128(liquidity) + 1, false) +
          1)
          .toInt256()
        : getQty0Delta(sqrtPriceA, sqrtPriceB, uint128(liquidity), true).toInt256();
  }

  /// @notice Helper that gets signed token1 delta
  /// @param sqrtPriceA A sqrt price
  /// @param sqrtPriceB Another sqrt price
  /// @param liquidity Liquidity delta for which to compute the token1 delta
  /// @return token1 quantity corresponding to the passed liquidityDelta between the two prices
  function getQty1Delta(
    uint160 sqrtPriceA,
    uint160 sqrtPriceB,
    int128 liquidity
  ) internal pure returns (int256) {
    return
      liquidity < 0
        ? (type(uint256).max -
          getQty1Delta(sqrtPriceA, sqrtPriceB, type(uint128).max - uint128(liquidity) + 1, false) +
          1)
          .toInt256()
        : getQty1Delta(sqrtPriceA, sqrtPriceB, uint128(liquidity), true).toInt256();
  }

  /// @notice Calculates the token0 quantity proportion to be sent to the user
  /// for burning reinvestment tokens
  /// @param sqrtPrice Current pool sqrt price
  /// @param lfDelta Difference in reinvestment liquidity due to reinvestment token burn
  /// @return token0 quantity to be sent to the user
  function getQty0FromBurnRTokens(uint160 sqrtPrice, uint256 lfDelta)
    internal
    pure
    returns (uint256)
  {
    return FullMath.mulDivFloor(lfDelta, MathConstants.TWO_POW_96, sqrtPrice);
  }

  /// @notice Calculates the token1 quantity proportion to be sent to the user
  /// for burning reinvestment tokens
  /// @param sqrtPrice Current pool sqrt price
  /// @param lfDelta Difference in reinvestment liquidity due to reinvestment token burn
  /// @return token1 quantity to be sent to the user
  function getQty1FromBurnRTokens(uint160 sqrtPrice, uint256 lfDelta)
    internal
    pure
    returns (uint256)
  {
    return FullMath.mulDivFloor(lfDelta, sqrtPrice, MathConstants.TWO_POW_96);
  }

  /// @notice Returns ceil(x / y)
  /// @dev division by 0 has unspecified behavior, and must be checked externally
  /// @param x The dividend
  /// @param y The divisor
  /// @return z The quotient, ceil(x / y)
  function divCeiling(uint256 x, uint256 y) internal pure returns (uint256 z) {
    assembly {
      z := add(div(x, y), gt(mod(x, y), 0))
    }
  }
}
