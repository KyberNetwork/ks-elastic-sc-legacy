// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.4;

import {LiqDeltaMath} from './libraries/LiqDeltaMath.sol';
import {SafeCast} from './libraries/SafeCast.sol';
import {MathConstants} from './libraries/MathConstants.sol';
import {FullMath} from './libraries/FullMath.sol';
import {TickMath} from './libraries/TickMath.sol';
import {Linkedlist} from './libraries/Linkedlist.sol';

import {IProAMMPoolTicksState} from './interfaces/pool/IProAMMPoolTicksState.sol';

contract ProAMMPoolTicksState is IProAMMPoolTicksState {
  using SafeCast for int256;
  using Linkedlist for mapping(int24 => Linkedlist.Data);

  // data stored for each initialized individual tick
  struct TickData {
    // gross liquidity of all positions in tick
    uint128 liquidityGross;
    // liquidity quantity to be added | removed when tick is crossed up | down
    int128 liquidityNet;
    // fee growth per unit of liquidity on the other side of this tick (relative to current tick)
    // only has relative meaning, not absolute — the value depends on when the tick is initialized
    uint256 feeGrowthOutside;
    // seconds spent on the other side of this tick (relative to current tick)
    // only has relative meaning, not absolute — the value depends on when the tick is initialized
    uint160 secondsPerLiquidityOutside;
    // true if liquidityGross != 0, false otherwise
    // this prevents fresh sstores when crossing newly initialized ticks
    bool initialized;
  }

  // data stored for each user's position
  struct Position {
    // the amount of liquidity owned by this position
    uint128 liquidity;
    // fee growth per unit of liquidity as of the last update to liquidity
    uint256 feeGrowthInsideLast;
  }

  struct UpdatePositionData {
    // address of owner of the position
    address owner;
    // position's lower and upper ticks
    int24 tickLower;
    int24 tickUpper;

    // TODO: Add back later
    // if minting, need to pass the previous initialized ticks for tickLower and tickUpper
    // int24 tickLowerPrevious;
    // int24 tickUpperPrevious;
    // any change in liquidity
    int128 liquidityDelta;
  }

  struct CumulativesData {
    uint256 feeGrowth;
    uint128 secondsPerLiquidity;
  }

  // uint128 public immutable maxLiquidityPerTick;

  int24 internal nearestCurrentTick; // nearest initialized tick to the poolTick
  mapping(int24 => TickData) public override ticks;
  mapping(int16 => uint256) public override tickBitmap;
  mapping(int24 => Linkedlist.Data) public initializedTicks;
  mapping(bytes32 => Position) internal positions;

  function initTickData() internal {
    nearestCurrentTick = TickMath.MIN_TICK;
    initializedTicks.init(TickMath.MIN_TICK, TickMath.MAX_TICK);
  }

  function getPositions(
    address owner,
    int24 tickLower,
    int24 tickUpper
  ) public view override returns (uint128 liquidity, uint256 feeGrowthInsideLast) {
    bytes32 key = positionKey(owner, tickLower, tickUpper);
    return (positions[key].liquidity, positions[key].feeGrowthInsideLast);
  }

  function _updatePosition(
    UpdatePositionData memory updateData,
    int24 currentTick,
    CumulativesData memory cumulatives,
    uint128 maxLiquidityPerTick,
    int24 tickSpacing
  ) internal returns (uint256 feesClaimable, uint256 feeGrowthInside) {
    // update ticks if necessary
    bool updateTickList;
    uint256 feeGrowthOutsideLowerTick;
    (feeGrowthOutsideLowerTick, updateTickList) = updateTick(
      updateData.tickLower,
      currentTick,
      updateData.liquidityDelta,
      cumulatives,
      true,
      maxLiquidityPerTick,
      tickSpacing
    );

    if (updateTickList) {
      _updateTickList(
        updateData.tickLower,
        // updateData.tickLowerPrevious,
        updateData.liquidityDelta > 0
      );
    }

    uint256 feeGrowthOutsideUpperTick;
    (feeGrowthOutsideUpperTick, updateTickList) = updateTick(
      updateData.tickUpper,
      currentTick,
      updateData.liquidityDelta,
      cumulatives,
      false,
      maxLiquidityPerTick,
      tickSpacing
    );

    if (updateTickList) {
      _updateTickList(
        updateData.tickUpper,
        // updateData.tickUpperPrevious,
        updateData.liquidityDelta > 0
      );
    }

    feeGrowthInside = getValueInside(
      feeGrowthOutsideLowerTick,
      feeGrowthOutsideUpperTick,
      currentTick < updateData.tickLower,
      currentTick < updateData.tickUpper,
      cumulatives.feeGrowth
    );

    // calc rTokens to be minted for the position's accumulated fees
    feesClaimable = updatePositionFee(updateData, feeGrowthInside);
  }

  function nextInitializedTick(
    int24 currentTick,
    int24,// tickSpacing,
    bool willUpTick
  ) internal view returns (int24 nextTick, bool initialized) {
    // TODO: Change logic to get the nearest tick to the current tick
    int24 nearestTick = nearestCurrentTick;
    if (nearestTick <= currentTick) {
      while (initializedTicks.goNext(nearestTick) <= currentTick) {
        nearestTick = initializedTicks.goNext(nearestTick);
      }
    } else {
      while (nearestTick > currentTick && nearestTick != TickMath.MIN_TICK) {
        nearestTick = initializedTicks.goBack(nearestTick);
      }
    }
    if (nearestTick == currentTick) {
      nextTick = willUpTick ? initializedTicks.goNext(nearestTick) : initializedTicks.goBack(nearestTick);
    } else {
      nextTick = willUpTick ? initializedTicks.goNext(nearestTick) : nearestTick;
    }
    initialized = (nextTick != TickMath.MIN_TICK && nextTick != TickMath.MAX_TICK);
  }

  function crossToTick(
    int24 nextTick,
    uint256 feeGrowthGlobal,
    uint160 secondsPerLiquidityGlobal
  ) internal returns (int128 liquidityNet) {
    ticks[nextTick].feeGrowthOutside = feeGrowthGlobal - ticks[nextTick].feeGrowthOutside;
    ticks[nextTick].secondsPerLiquidityOutside =
      secondsPerLiquidityGlobal -
      ticks[nextTick].secondsPerLiquidityOutside;
    liquidityNet = ticks[nextTick].liquidityNet;
  }

  function calcMaxLiquidityPerTick(int24 tickSpacing) internal pure returns (uint128) {
    int24 minTick = (TickMath.MIN_TICK / tickSpacing) * tickSpacing;
    int24 maxTick = (TickMath.MAX_TICK / tickSpacing) * tickSpacing;
    uint24 numTicks = uint24((maxTick - minTick) / tickSpacing) + 1;
    return type(uint128).max / numTicks;
  }

  function positionKey(
    address owner,
    int24 tickLower,
    int24 tickUpper
  ) private pure returns (bytes32) {
    return keccak256(abi.encodePacked(owner, tickLower, tickUpper));
  }

  function updatePositionFee(UpdatePositionData memory _data, uint256 feeGrowthInside)
    private
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

  /// @notice Retrieves either fee growth or seconds per liquidity inside
  /// @param tickLowerGrowthOutside Lower tick's feeGrowthOutside or secondsPerLiquidityOutside
  /// @param tickUpperGrowthOutside Upper tick's feeGrowthOutside or secondsPerLiquidityOutside
  /// @param tickCurrentBelowLower True if pool tick is below lower tick, false otherwise
  /// @param tickCurrentBelowUpper True if pool tick is below upper tick, false otherwise
  /// @param growthGlobal All-time global fee growth or seconds per unit of liquidity
  /// @return growthInside Value inside per unit of liquidity, inside the position's tick boundaries
  function getValueInside(
    uint256 tickLowerGrowthOutside,
    uint256 tickUpperGrowthOutside,
    bool tickCurrentBelowLower,
    bool tickCurrentBelowUpper,
    uint256 growthGlobal
  ) internal pure returns (uint256 growthInside) {
    uint256 growthBelow = tickCurrentBelowLower
      ? growthGlobal - tickLowerGrowthOutside
      : tickLowerGrowthOutside;

    uint256 growthAbove = tickCurrentBelowUpper
      ? tickUpperGrowthOutside
      : growthGlobal - tickUpperGrowthOutside;

    growthInside = growthGlobal - growthBelow - growthAbove;
  }

  /// @notice Updates a tick and returns true if the tick was flipped from initialized to uninitialized, or vice versa
  /// @param tick Tick to be updated
  /// @param tickCurrent Current tick
  /// @param liquidityDelta Liquidity quantity to be added | removed when tick is crossed up | down
  /// @param cumulatives All-time global fee growth and seconds, per unit of liquidity
  /// @param isLower true | false if updating a position's lower | upper tick
  /// @param maxLiquidity The maximum liquidity allocation for a single tick
  /// @return feeGrowthOutside last value of feeGrowthOutside
  /// @return updateTickList should add or remove the tick
  function updateTick(
    int24 tick,
    int24 tickCurrent,
    int128 liquidityDelta,
    CumulativesData memory cumulatives,
    bool isLower,
    uint128 maxLiquidity,
    int24 tickSpacing
  ) private returns (uint256 feeGrowthOutside, bool updateTickList) {
    require(tick % tickSpacing == 0);
    uint128 liquidityGrossBefore = ticks[tick].liquidityGross;
    uint128 liquidityGrossAfter = LiqDeltaMath.addLiquidityDelta(
      liquidityGrossBefore,
      liquidityDelta
    );
    require(liquidityGrossAfter <= maxLiquidity, '> max liquidity');
    // if lower tick, liquidityDelta should be added | removed when crossed up | down
    // else, for upper tick, liquidityDelta should be removed | added when crossed up | down
    int128 liquidityNetAfter = isLower
      ? ticks[tick].liquidityNet + liquidityDelta
      : ticks[tick].liquidityNet - liquidityDelta;

    if (liquidityGrossBefore == 0) {
      // by convention, we assume that all growth before a tick was initialized happened _below_ the tick
      if (tick <= tickCurrent) {
        ticks[tick].feeGrowthOutside = cumulatives.feeGrowth;
        ticks[tick].secondsPerLiquidityOutside = cumulatives.secondsPerLiquidity;
      }

      ticks[tick].initialized = true;
    }

    ticks[tick].liquidityGross = liquidityGrossAfter;
    ticks[tick].liquidityNet = liquidityNetAfter;
    feeGrowthOutside = ticks[tick].feeGrowthOutside;

    if (liquidityGrossBefore > 0 && liquidityGrossAfter == 0) {
      delete ticks[tick];
    }
    updateTickList = (liquidityGrossBefore > 0) != (liquidityGrossAfter > 0);
  }

  /**
   * @dev Update the tick linkedlist
   * @param tick tick index to update
  //  *  previousTick the nearest initialized tick that is lower than the tick, in case adding
   * @param isAdd whether is add or remove the tick
   */
  function _updateTickList(
    int24 tick,
    // int24 previousTick,
    bool isAdd
  ) private {
    if (isAdd) {
      // TODO: Get this data from input params
      int24 previousTick = TickMath.MIN_TICK;
      while (initializedTicks.goNext(previousTick) <= tick) {
        previousTick = initializedTicks.goNext(previousTick);
      }
      if (tick == previousTick) return;
      initializedTicks.insert(tick, previousTick);
    } else {
      if (tick == nearestCurrentTick) {
        nearestCurrentTick = initializedTicks.remove(tick);
      } else {
        initializedTicks.remove(tick);
      }
    }
  }
}
