// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

interface IProAMMPoolTicksState {
  /// @notice Look up information about a specific tick in the pool
  /// @param tick The tick to look up
  /// @return liquidityGross the total amount of position liquidity
  /// that uses the pool either as tick lower or tick upper
  /// liquidityNet how much liquidity changes when the pool tick crosses above the tick
  /// feeGrowthOutside the fee growth on the other side of the tick from the current tick
  /// secondsPerLiquidityOutside the seconds spent on the other side of the tick from the current tick
  /// initialized True iff liquidityGross is greater than 0, otherwise equal to false.
  function ticks(int24 tick)
    external
    view
    returns (
      uint128 liquidityGross,
      int128 liquidityNet,
      uint256 feeGrowthOutside,
      uint160 secondsPerLiquidityOutside,
      bool initialized
    );

  /// @notice Returns 256 packed tick initialized boolean values. See TickBitmap for more information
  function tickBitmap(int16 wordPosition) external view returns (uint256);

  /// @notice Returns the information about a position by the position's key
  /// @return liquidity liquidity quantity of the position
  /// @return feeGrowthInsideLast fee growth inside the tick range as of the last mint / burn action performed
  function getPositions(
    address owner,
    int24 tickLower,
    int24 tickUpper
  ) external view returns (uint128 liquidity, uint256 feeGrowthInsideLast);
}
