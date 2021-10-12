// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.9;

import {LiqDeltaMath} from './libraries/LiqDeltaMath.sol';
import {SafeCast} from './libraries/SafeCast.sol';
import {MathConstants} from './libraries/MathConstants.sol';
import {FullMath} from './libraries/FullMath.sol';
import {TickMath} from './libraries/TickMath.sol';
import {Linkedlist} from './libraries/Linkedlist.sol';

import {PoolStorage} from './PoolStorage.sol';

contract PoolTicksState is PoolStorage {
  using SafeCast for int256;
  using Linkedlist for mapping(int24 => Linkedlist.Data);

  struct UpdatePositionData {
    // address of owner of the position
    address owner;
    // position's lower and upper ticks
    int24 tickLower;
    int24 tickUpper;
    // if minting, need to pass the previous initialized ticks for tickLower and tickUpper
    int24 tickLowerPrevious;
    int24 tickUpperPrevious;
    // any change in liquidity
    int128 liquidityDelta;
  }

  function _updatePosition(
    UpdatePositionData memory updateData,
    int24 currentTick,
    CumulativesData memory cumulatives
  ) internal returns (uint256 feesClaimable, uint256 feeGrowthInside) {
    // update ticks if necessary
    uint256 feeGrowthOutsideLowerTick = _updateTick(
      updateData.tickLower,
      currentTick,
      updateData.tickLowerPrevious,
      updateData.liquidityDelta,
      cumulatives,
      true
    );

    uint256 feeGrowthOutsideUpperTick = _updateTick(
      updateData.tickUpper,
      currentTick,
      updateData.tickUpperPrevious,
      updateData.liquidityDelta,
      cumulatives,
      false
    );

    // calculate feeGrowthInside
    unchecked {
      if (currentTick < updateData.tickLower) {
        feeGrowthInside = feeGrowthOutsideLowerTick - feeGrowthOutsideUpperTick;
      } else if (currentTick >= updateData.tickUpper) {
        feeGrowthInside = feeGrowthOutsideUpperTick - feeGrowthOutsideLowerTick;
      } else {
        feeGrowthInside =
          cumulatives.feeGrowth -
          feeGrowthOutsideLowerTick -
          feeGrowthOutsideUpperTick;
      }
    }

    // calc rTokens to be minted for the position's accumulated fees
    feesClaimable = _updatePositionData(updateData, feeGrowthInside);
  }

  /// @dev Update liquidity net data and do cross tick
  function _updateLiquidityAndCrossTick(
    int24 nextTick,
    uint128 currentLiquidity,
    uint256 feeGrowthGlobal,
    uint128 secondsPerLiquidityGlobal,
    bool willUpTick
  ) internal returns (uint128 newLiquidity, int24 newNextTick) {
    unchecked {
      ticks[nextTick].feeGrowthOutside = feeGrowthGlobal - ticks[nextTick].feeGrowthOutside;
      ticks[nextTick].secondsPerLiquidityOutside =
        secondsPerLiquidityGlobal -
        ticks[nextTick].secondsPerLiquidityOutside;
    }
    int128 liquidityNet = ticks[nextTick].liquidityNet;
    if (willUpTick) {
      newNextTick = initializedTicks[nextTick].next;
    } else {
      newNextTick = initializedTicks[nextTick].previous;
      liquidityNet = -liquidityNet;
    }
    newLiquidity = LiqDeltaMath.addLiquidityDelta(currentLiquidity, liquidityNet);
  }

  function _updatePoolData(
    uint128 newLiquidity,
    uint128 newRLiquidity,
    uint160 newSqrtP,
    int24 newCurrentTick,
    int24 nextTick
  ) internal {
    poolData.liquidity = newLiquidity;
    poolData.reinvestmentLiquidity = newRLiquidity;
    poolData.sqrtP = newSqrtP;
    poolData.currentTick = newCurrentTick;
    poolData.nearestCurrentTick = nextTick > newCurrentTick
      ? initializedTicks[nextTick].previous
      : nextTick;
  }

  /// @dev Return initial data before swapping
  /// @param willUpTick whether is up/down tick
  /// @return poolLiquidity current pool liquidity
  /// @return poolReinvestmentLiquidity current pool reinvestment liquidity
  /// @return sqrtP current pool sqrt price
  /// @return poolCurrentTick current pool tick
  /// @return poolNextTick next tick to calculate data
  function _getInitialSwapData(bool willUpTick)
    internal
    view
    returns (
      uint128 poolLiquidity,
      uint128 poolReinvestmentLiquidity,
      uint160 sqrtP,
      int24 poolCurrentTick,
      int24 poolNextTick
    )
  {
    poolLiquidity = poolData.liquidity;
    poolReinvestmentLiquidity = poolData.reinvestmentLiquidity;
    sqrtP = poolData.sqrtP;
    poolCurrentTick = poolData.currentTick;
    poolNextTick = poolData.nearestCurrentTick;
    if (willUpTick) {
      poolNextTick = initializedTicks[poolNextTick].next;
    }
  }

  function _updatePositionData(UpdatePositionData memory _data, uint256 feeGrowthInside)
    private
    returns (uint256 feesClaimable)
  {
    bytes32 key = _positionKey(_data.owner, _data.tickLower, _data.tickUpper);
    // calculate accumulated fees for current liquidity
    // feeGrowthInside is relative value, hence underflow is acceptable
    uint256 feeGrowth;
    unchecked {
      feeGrowth = feeGrowthInside - positions[key].feeGrowthInsideLast;
    }
    uint128 prevLiquidity = positions[key].liquidity;
    feesClaimable = FullMath.mulDivFloor(feeGrowth, prevLiquidity, MathConstants.TWO_POW_96);
    // update the position
    positions[key].liquidity = LiqDeltaMath.addLiquidityDelta(prevLiquidity, _data.liquidityDelta);
    positions[key].feeGrowthInsideLast = feeGrowthInside;
  }

  /// @notice Updates a tick and returns the fee growth outside of that tick
  /// @param tick Tick to be updated
  /// @param tickCurrent Current tick
  /// @param tickPrevious the nearest initialized tick which is lower than or equal to `tick`
  /// @param liquidityDelta Liquidity quantity to be added | removed when tick is crossed up | down
  /// @param cumulatives All-time global fee growth and seconds, per unit of liquidity
  /// @param isLower true | false if updating a position's lower | upper tick
  /// @return feeGrowthOutside last value of feeGrowthOutside
  function _updateTick(
    int24 tick,
    int24 tickCurrent,
    int24 tickPrevious,
    int128 liquidityDelta,
    CumulativesData memory cumulatives,
    bool isLower
  )
    private
    returns (
      // tickPrevious,
      uint256 feeGrowthOutside
    )
  {
    uint128 liquidityGrossBefore = ticks[tick].liquidityGross;
    uint128 liquidityGrossAfter = LiqDeltaMath.addLiquidityDelta(
      liquidityGrossBefore,
      liquidityDelta
    );
    require(liquidityGrossAfter <= maxTickLiquidity, '> max liquidity');
    // if lower tick, liquidityDelta should be added | removed when crossed up | down
    // else, for upper tick, liquidityDelta should be removed | added when crossed up | down
    int128 liquidityNetAfter = isLower
      ? ticks[tick].liquidityNet + liquidityDelta
      : ticks[tick].liquidityNet - liquidityDelta;

    if (liquidityGrossBefore == 0) {
      // by convention, all growth before a tick was initialized is assumed to happen below it
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
      _updateTickList(tick, tickPrevious, tickCurrent, liquidityDelta > 0);
    }
  }

  /// @dev Update the tick linkedlist, assume that tick is not in the list
  /// @param tick tick index to update
  /// @param currentTick the pool currentt tick
  /// @param previousTick the nearest initialized tick that is lower than the tick, in case adding
  /// @param isAdd whether is add or remove the tick
  function _updateTickList(
    int24 tick,
    int24 previousTick,
    int24 currentTick,
    bool isAdd
  ) internal {
    if (isAdd) {
      if (tick == TickMath.MIN_TICK || tick == TickMath.MAX_TICK) return;
      // find the correct previousTick to the `tick`, avoid revert when new liquidity has been added between tick & previousTick
      int24 nextTick = initializedTicks[previousTick].next;
      require(
        nextTick != initializedTicks[previousTick].previous,
        'previous tick has been removed'
      );
      uint256 iteration = 0;
      while (nextTick <= tick && iteration < MathConstants.MAX_TICK_TRAVEL) {
        previousTick = nextTick;
        nextTick = initializedTicks[previousTick].next;
        iteration++;
      }
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
