// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.4;

import {LiqDeltaMath} from './libraries/LiqDeltaMath.sol';
import {SafeCast} from './libraries/SafeCast.sol';
import {MathConstants} from './libraries/MathConstants.sol';
import {FullMath} from './libraries/FullMath.sol';
import {Linkedlist} from './libraries/Linkedlist.sol';
import {PoolStorage, TickMath} from './PoolStorage.sol';

contract ProAMMPoolTicksState is PoolStorage {
  using SafeCast for int256;
  using Linkedlist for mapping(int24 => Linkedlist.Data);

  function updatePosition(
    UpdatePositionData memory updateData,
    int24 currentTick,
    CumulativesData memory cumulatives,
    uint128 maxLiquidityPerTick
  ) internal returns (uint256 feesClaimable, uint256 feeGrowthInside) {
    // update ticks if necessary
    uint256 feeGrowthOutsideLowerTick = _updateTick(
      updateData.tickLower,
      currentTick,
      updateData.liquidityDelta,
      cumulatives,
      true,
      maxLiquidityPerTick
      // updateData.tickLowerPrevious,
    );

    uint256 feeGrowthOutsideUpperTick = _updateTick(
      updateData.tickUpper,
      currentTick,
      updateData.liquidityDelta,
      cumulatives,
      false,
      maxLiquidityPerTick
      // updateData.tickUpperPrevious,
    );

    feeGrowthInside = getValueInside(
      feeGrowthOutsideLowerTick,
      feeGrowthOutsideUpperTick,
      currentTick < updateData.tickLower,
      currentTick < updateData.tickUpper,
      cumulatives.feeGrowth
    );

    // calc rTokens to be minted for the position's accumulated fees
    feesClaimable = _updatePositionFee(updateData, feeGrowthInside);
  }

  /// @dev Update liquidity net data and do cross tick if it should
  function updateLiquidityAndCrossTick(
    int24 currentTick,
    int24 nextTick,
    uint128 currentLiquidity,
    uint256 feeGrowthGlobal,
    uint128 secondsPerLiquidityGlobal,
    bool willUpTick,
    bool shouldCross
  )
    internal
    returns (uint128 newLiquidity, int24 newCurrentTick, int24 newNextTick)
  {
    if (shouldCross) {
      unchecked {
        ticks[nextTick].feeGrowthOutside = feeGrowthGlobal - ticks[nextTick].feeGrowthOutside;
        ticks[nextTick].secondsPerLiquidityOutside =
          secondsPerLiquidityGlobal - ticks[nextTick].secondsPerLiquidityOutside;
      }
      newCurrentTick = willUpTick ? nextTick : nextTick - 1;
      newNextTick = willUpTick ? initializedTicks[nextTick].next : initializedTicks[nextTick].previous;
    } else {
      newCurrentTick = currentTick;
    }

    newLiquidity = LiqDeltaMath.addLiquidityDelta(
      currentLiquidity,
      willUpTick ? ticks[nextTick].liquidityNet : -ticks[nextTick].liquidityNet
    );
  }

  function updatePoolData(
    uint128 newLiquidity,
    uint128 newRLiquidity,
    uint160 newSqrtPrice,
    int24 nextTick,
    int24 newCurrentTick
  ) internal {
    poolData.liquidity = newLiquidity;
    poolData.reinvestmentLiquidity = newRLiquidity;
    poolData.sqrtPrice = newSqrtPrice;
    poolData.currentTick = newCurrentTick;
    poolData.nearestCurrentTick = nextTick > newCurrentTick
      ? initializedTicks[nextTick].previous
      : nextTick;
  }

  /// @notice Retrieves either fee growth or seconds per liquidity inside
  ///   the value could be negative, thus, use unchecked here
  /// @param tickLowerGrowthOutside Lower tick's feeGrowthOutside or secondsPerLiquidityOutside
  /// @param tickUpperGrowthOutside Upper tick's feeGrowthOutside or secondsPerLiquidityOutside
  /// @param tickCurrentBelowLower True if pool tick is below lower tick, false otherwise
  /// @param tickCurrentBelowUpper True if pool tick is below upper tick, false otherwise
  /// @param growthGlobal All-time global fee growth or seconds per unit of liquidity
  /// Return the value inside per unit of liquidity, inside the position's tick boundaries
  function getValueInside(
    uint256 tickLowerGrowthOutside,
    uint256 tickUpperGrowthOutside,
    bool tickCurrentBelowLower,
    bool tickCurrentBelowUpper,
    uint256 growthGlobal
  ) internal pure returns (uint256) {
    unchecked {
      if (tickCurrentBelowLower) return tickLowerGrowthOutside - tickUpperGrowthOutside;
      if (!tickCurrentBelowUpper) return tickUpperGrowthOutside - tickLowerGrowthOutside;
      return growthGlobal - tickLowerGrowthOutside - tickUpperGrowthOutside;
    }
  }

  /**
   * @dev Return initial data before swapping
   * @param willUpTick whether is up/down tick
   * @param sqrtPriceLimit price limit for the swap to check
   * @return poolLiquidity current pool liquidity
   * @return poolReinvestmentLiquidity current pool reinvestment liquidity
   * @return poolSqrtPrice current pool sqrt price
   * @return poolCurrentTick current pool tick
   * @return poolNextTick next tick to calculate data
   */
  function getInitialSwapData(bool willUpTick, uint160 sqrtPriceLimit)
    internal view
    returns(
      uint128 poolLiquidity,
      uint128 poolReinvestmentLiquidity,
      uint160 poolSqrtPrice,
      int24 poolCurrentTick,
      int24 poolNextTick
    )
  {
    poolLiquidity = poolData.liquidity;
    poolReinvestmentLiquidity = poolData.reinvestmentLiquidity;
    poolSqrtPrice = poolData.sqrtPrice;
    poolCurrentTick = poolData.currentTick;

    if (willUpTick) {
      require(
        sqrtPriceLimit > poolSqrtPrice && sqrtPriceLimit < TickMath.MAX_SQRT_RATIO,
        'bad sqrtPriceLimit'
      );
      poolNextTick = initializedTicks[poolData.nearestCurrentTick].next;
    } else {
      require(
        sqrtPriceLimit < poolSqrtPrice && sqrtPriceLimit > TickMath.MIN_SQRT_RATIO,
        'bad sqrtPriceLimit'
      );
      poolNextTick = poolData.nearestCurrentTick;
    }
  }

  function _updatePositionFee(UpdatePositionData memory _data, uint256 feeGrowthInside)
    private
    returns (uint256 feesClaimable)
  {
    bytes32 key = positionKey(_data.owner, _data.tickLower, _data.tickUpper);
    Position memory _position = positions[key];

    // calculate accumulated fees for current liquidity
    // (ie. does not include liquidityDelta)
    // it could grow from negative value to a positive value, thus, need to use unchecked here
    uint256 feeGrowth;
    unchecked { feeGrowth = feeGrowthInside - _position.feeGrowthInsideLast; }
    feesClaimable = FullMath.mulDivFloor(
      feeGrowth,
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

  /// @notice Updates a tick and returns the fee growth outside of that tick
  /// @param tick Tick to be updated
  /// @param tickCurrent Current tick
  /// @param liquidityDelta Liquidity quantity to be added | removed when tick is crossed up | down
  /// @param cumulatives All-time global fee growth and seconds, per unit of liquidity
  /// @param isLower true | false if updating a position's lower | upper tick
  /// @param maxLiquidity The maximum liquidity allocation for a single tick
  /// @return feeGrowthOutside last value of feeGrowthOutside
  function _updateTick(
    int24 tick,
    int24 tickCurrent,
    int128 liquidityDelta,
    CumulativesData memory cumulatives,
    bool isLower,
    uint128 maxLiquidity
    // tickPrevious,
  ) private returns (uint256 feeGrowthOutside) {
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
    }

    ticks[tick].liquidityGross = liquidityGrossAfter;
    ticks[tick].liquidityNet = liquidityNetAfter;
    feeGrowthOutside = ticks[tick].feeGrowthOutside;

    if (liquidityGrossBefore > 0 && liquidityGrossAfter == 0) {
      delete ticks[tick];
    }

    if ((liquidityGrossBefore > 0) != (liquidityGrossAfter > 0)) {
      _updateTickList(tick, tickCurrent, liquidityDelta > 0);
    }
  }

  /**
   * @dev Update the tick linkedlist
   * @param tick tick index to update
   * @param currentTick the pool currentt tick
  //  *  previousTick the nearest initialized tick that is lower than the tick, in case adding
   * @param isAdd whether is add or remove the tick
   */
  function _updateTickList(
    int24 tick,
    // int24 previousTick,
    int24 currentTick,
    bool isAdd
  ) private {
    if (isAdd) {
      // TODO: Get this data from input params
      int24 previousTick = TickMath.MIN_TICK;
      while (initializedTicks[previousTick].next <= tick) {
        previousTick = initializedTicks[previousTick].next;
      }
      if (tick == previousTick) return;
      initializedTicks.insert(tick, previousTick);
      if (poolData.nearestCurrentTick < tick && tick <= currentTick) {
        poolData.nearestCurrentTick = tick;
      }
    } else {
      if (tick == poolData.nearestCurrentTick) {
        poolData.nearestCurrentTick = initializedTicks.remove(tick);
      } else {
        initializedTicks.remove(tick);
      }
    }
  }
}
