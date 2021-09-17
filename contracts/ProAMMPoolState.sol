// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.4;

import {TickBitmap} from './libraries/TickBitmap.sol';
import {LiqDeltaMath} from './libraries/LiqDeltaMath.sol';
import {SafeCast} from './libraries/SafeCast.sol';
import {MathConstants} from './libraries/MathConstants.sol';
import {FullMath} from './libraries/FullMath.sol';

contract ProAmmPoolState {
  using SafeCast for int256;
  using TickBitmap for mapping(int16 => uint256);

  // data stored for each initialized individual tick
  struct TickData {
    // gross liquidity of all positions in tick
    uint128 liquidityGross;
    // liquidity quantity to be added | removed when tick is crossed up | down
    int128 liquidityNet;
    // fee growth per unit of liquidity on the other side of this tick (relative to current tick)
    // only has relative meaning, not absolute — the value depends on when the tick is initialized
    uint256 feeGrowthOutside;
    // true iff the tick is initialized, when liquidityGross != 0
    // these 8 bits are set to prevent fresh sstores when crossing newly initialized ticks
    bool initialized;
  }

  // data stored for each user's position
  struct Position {
    // the amount of liquidity owned by this position
    uint128 liquidity;
    // fee growth per unit of liquidity as of the last update to liquidity
    uint256 feeGrowthInsideLast;
  }

  struct TweakPositionData {
    // address of owner of the position
    address owner;
    // position's lower and upper ticks
    int24 tickLower;
    int24 tickUpper;
    // any change in liquidity
    int128 liquidityDelta;
  }

  mapping(int24 => TickData) public ticks;
  mapping(int16 => uint256) public tickBitmap;
  mapping(bytes32 => Position) internal positions;

  function _updatePosition(
    TweakPositionData memory _tweakPositionData,
    int24 currentTick,
    uint128 lp,
    uint256 lf,
    uint256 _feeGrowthGlobal,
    uint128 maxLiquidityPerTick,
    int24 tickSpacing
  ) private returns (uint256 feesClaimable) {
    // update ticks if necessary
    bool flippedLower = updateTick(
      _tweakPositionData.tickLower,
      currentTick,
      _tweakPositionData.liquidityDelta,
      _feeGrowthGlobal,
      true,
      maxLiquidityPerTick
    );
    if (flippedLower) {
      tickBitmap.flipTick(_tweakPositionData.tickLower, tickSpacing);
    }
    bool flippedUpper = updateTick(
      _tweakPositionData.tickUpper,
      currentTick,
      _tweakPositionData.liquidityDelta,
      _feeGrowthGlobal,
      false,
      maxLiquidityPerTick
    );
    if (flippedUpper) {
      tickBitmap.flipTick(_tweakPositionData.tickUpper, tickSpacing);
    }

    uint256 feeGrowthInside = getFeeGrowthInside(
      _tweakPositionData.tickLower,
      _tweakPositionData.tickUpper,
      currentTick,
      _feeGrowthGlobal
    );

    // calc rTokens to be minted for the position's accumulated fees
    feesClaimable = updatePosition(_tweakPositionData, feeGrowthInside);
  }

  function positionKey(
    address owner,
    int24 tickLower,
    int24 tickUpper
  ) internal pure returns (bytes32) {
    return keccak256(abi.encodePacked(owner, tickLower, tickUpper));
  }

  function updatePosition(TweakPositionData memory _data, uint256 feeGrowthInside)
    internal
    returns (uint256 feesClaimable)
  {
    bytes32 key = positionKey(_data.owner, _data.tickLower, _data.tickUpper);
    Position memory _position = positions[key];

    // calculate accumulated fees for current liquidity
    // (ie. does not include liquidityDelta)
    feesClaimable = FullMath.mulDivFloor(
      feeGrowthInside - _position.feeGrowthInsideLast,
      _position.liquidity,
      MathConstants.TWO_POW_96
    );
    // update the position
    positions[key].liquidity = LiqDeltaMath.addLiquidityDelta(
      _position.liquidity,
      _data.liquidityDelta
    );
    positions[key].feeGrowthInsideLast = feeGrowthInside;
  }

  function getFeeGrowthInside(
    int24 tickLower,
    int24 tickUpper,
    int24 tickCurrent,
    uint256 feeGrowthGlobal
  ) internal view returns (uint256 feeGrowthInside) {
    TickData storage lower = ticks[tickLower];
    TickData storage upper = ticks[tickUpper];

    uint256 feeGrowthBelow = (tickCurrent >= tickLower)
      ? lower.feeGrowthOutside
      : feeGrowthGlobal - lower.feeGrowthOutside;

    uint256 feeGrowthAbove = (tickCurrent < tickUpper)
      ? upper.feeGrowthOutside
      : feeGrowthGlobal - upper.feeGrowthOutside;

    feeGrowthInside = feeGrowthGlobal - feeGrowthBelow - feeGrowthAbove;
  }

  /// @notice Updates a tick and returns true if the tick was flipped from initialized to uninitialized, or vice versa
  /// @param tick Tick to be updated
  /// @param tickCurrent Current tick
  /// @param liquidityDelta Liquidity quantity to be added | removed when tick is crossed up | down
  /// @param feeGrowthGlobal All-time global fee growth, per unit of liquidity
  /// @param isLower true | false if updating a position's lower | upper tick
  /// @param maxLiquidity The maximum liquidity allocation for a single tick
  /// @return flipped Whether the tick was flipped from initialized to uninitialized, or vice versa
  function updateTick(
    int24 tick,
    int24 tickCurrent,
    int128 liquidityDelta,
    uint256 feeGrowthGlobal,
    bool isLower,
    uint128 maxLiquidity
  ) internal returns (bool flipped) {
    uint128 liquidityGrossBefore = ticks[tick].liquidityGross;
    uint128 liquidityGrossAfter = LiqDeltaMath.addLiquidityDelta(
      liquidityGrossBefore,
      liquidityDelta
    );

    require(liquidityGrossAfter <= maxLiquidity, '> max liquidity');

    flipped = (liquidityGrossAfter == 0) != (liquidityGrossBefore == 0);

    if (liquidityGrossBefore == 0) {
      // by convention, we assume that all growth before a tick was initialized happened _below_ the tick
      if (tick <= tickCurrent) ticks[tick].feeGrowthOutside = feeGrowthGlobal;
      ticks[tick].initialized = true;
    }

    ticks[tick].liquidityGross = liquidityGrossAfter;

    // if lower tick, liquidityDelta should be added | removed when crossed up | down
    // else, for upper tick, liquidityDelta should be removed | added when crossed up | down
    ticks[tick].liquidityNet = isLower
      ? ticks[tick].liquidityNet + liquidityDelta
      : ticks[tick].liquidityNet - liquidityDelta;

    if (flipped && liquidityDelta < 0) {
      delete ticks[tick];
    }
  }
}
