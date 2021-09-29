// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

import {MathConstants as C} from './MathConstants.sol';
import {TickMath} from './TickMath.sol';
import {FullMath} from './FullMath.sol';
import {SafeCast} from './SafeCast.sol';

/// @title Contains helper functions for calculating
/// token0 and token1 quantites from differences in prices
/// or from burning reinvestment tokens
library QtyDeltaMath {
  using SafeCast for uint256;
  using SafeCast for int128;

  function getQtysForInitialLockup(uint160 initialSqrtPrice, uint128 liquidity)
    internal
    pure
    returns (uint256 qty0, uint256 qty1)
  {
    qty0 = FullMath.mulDivCeiling(liquidity, C.TWO_POW_96, initialSqrtPrice);
    qty1 = FullMath.mulDivCeiling(liquidity, initialSqrtPrice, C.TWO_POW_96);
  }

  /// @notice Gets the qty0 delta between two prices
  /// @dev Calculates liquidity / sqrt(lower) - liquidity / sqrt(upper),
  /// i.e. liquidity * (sqrt(upper) - sqrt(lower)) / (sqrt(upper) * sqrt(lower))
  /// @param lowerSqrtP The lower sqrt price.
  /// @param upperSqrtP The upper sqrt price. Should be >= lowerSqrtP
  /// @param liquidity Liquidity quantity
  /// @param roundUp Whether to round the result up or down
  /// @return token0 qty required for position with liquidity between the 2 sqrt prices
  function calcRequiredQty0(
    uint160 lowerSqrtP,
    uint160 upperSqrtP,
    uint128 liquidity,
    bool roundUp
  ) internal pure returns (uint256) {
    uint256 numerator1 = uint256(liquidity) << C.RES_96;
    uint256 numerator2;
    unchecked {
      numerator2 = upperSqrtP - lowerSqrtP;
    }
    return
      roundUp
        ? divCeiling(FullMath.mulDivCeiling(numerator1, numerator2, upperSqrtP), lowerSqrtP)
        : FullMath.mulDivFloor(numerator1, numerator2, upperSqrtP) / lowerSqrtP;
  }

  /// @notice Gets the token1 delta quantity between two prices
  /// @dev Calculates liquidity * (sqrt(upper) - sqrt(lower))
  /// @param lowerSqrtP The lower sqrt price.
  /// @param upperSqrtP The upper sqrt price. Should be >= lowerSqrtP
  /// @param liquidity Liquidity quantity
  /// @param roundUp Whether to round the result up or down
  /// @return token1 qty required for position with liquidity between the 2 sqrt prices
  function calcRequiredQty1(
    uint160 lowerSqrtP,
    uint160 upperSqrtP,
    uint128 liquidity,
    bool roundUp
  ) internal pure returns (uint256) {
    unchecked {
      return
        roundUp
          ? FullMath.mulDivCeiling(liquidity, upperSqrtP - lowerSqrtP, C.TWO_POW_96)
          : FullMath.mulDivFloor(liquidity, upperSqrtP - lowerSqrtP, C.TWO_POW_96);
    }
  }

  /// @notice Gets token0 qty required for liquidity between the two ticks
  /// @param lowerSqrtP The lower sqrt price
  /// @param upperSqrtP The upper sqrt price, assumed to be > lowerSqrtP
  /// @param liquidity Liquidity delta for which to compute the token0 delta
  /// @return token0 quantity corresponding to the liquidity between the two ticks
  function calcRequiredQty0(
    uint160 lowerSqrtP,
    uint160 upperSqrtP,
    int128 liquidity
  ) internal pure returns (int256) {
    return
      (liquidity < 0)
        ? calcRequiredQty0(lowerSqrtP, upperSqrtP, liquidity.revToUint128(), false).revToInt256()
        : calcRequiredQty0(lowerSqrtP, upperSqrtP, uint128(liquidity), true).toInt256();
  }

  /// @notice Gets token0 qty required for liquidity between the two ticks
  /// @param lowerSqrtP The lower sqrt price
  /// @param upperSqrtP The upper sqrt price, assumed to be > lowerSqrtP
  /// @param liquidity Liquidity delta for which to compute the token1 delta
  /// @return token1 quantity corresponding to the liquidity between the two ticks
  function calcRequiredQty1(
    uint160 lowerSqrtP,
    uint160 upperSqrtP,
    int128 liquidity
  ) internal pure returns (int256) {
    return
      liquidity < 0
        ? calcRequiredQty1(lowerSqrtP, upperSqrtP, liquidity.revToUint128(), false).revToInt256()
        : calcRequiredQty1(lowerSqrtP, upperSqrtP, uint128(liquidity), true).toInt256();
  }

  /// @notice Calculates the token0 quantity proportion to be sent to the user
  /// for burning reinvestment tokens
  /// @param sqrtPrice Current pool sqrt price
  /// @param liquidity Difference in reinvestment liquidity due to reinvestment token burn
  /// @return token0 quantity to be sent to the user
  function getQty0FromBurnRTokens(uint160 sqrtPrice, uint256 liquidity)
    internal
    pure
    returns (uint256)
  {
    return FullMath.mulDivFloor(liquidity, C.TWO_POW_96, sqrtPrice);
  }

  /// @notice Calculates the token1 quantity proportion to be sent to the user
  /// for burning reinvestment tokens
  /// @param sqrtPrice Current pool sqrt price
  /// @param liquidity Difference in reinvestment liquidity due to reinvestment token burn
  /// @return token1 quantity to be sent to the user
  function getQty1FromBurnRTokens(uint160 sqrtPrice, uint256 liquidity)
    internal
    pure
    returns (uint256)
  {
    return FullMath.mulDivFloor(liquidity, sqrtPrice, C.TWO_POW_96);
  }

  /// @notice Returns ceil(x / y)
  /// @dev division by 0 has unspecified behavior, and must be checked externally
  /// @param x The dividend
  /// @param y The divisor
  /// @return z The quotient, ceil(x / y)
  function divCeiling(uint256 x, uint256 y) internal pure returns (uint256 z) {
    // return x / y + ((x % y == 0) ? 0 : 1);
    require(y > 0);
    assembly {
      z := add(div(x, y), gt(mod(x, y), 0))
    }
  }
}
