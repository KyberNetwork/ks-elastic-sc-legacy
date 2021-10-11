// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import {ProAMMPoolTicksState} from '../ProAMMPoolTicksState.sol';

contract MockPoolTicksStateFactory {
  struct Parameters {
    address factory;
    address token0;
    address token1;
    uint16 swapFeeBps;
    int24 tickDistance;
  }

  Parameters public parameters;
  MockPoolTicksState public state;

  function create(
    address token0,
    address token1,
    uint16 swapFeeBps,
    int24 tickDistance
  ) external {
    parameters.factory = address(this);
    parameters.token0 = token0;
    parameters.token1 = token1;
    parameters.swapFeeBps = swapFeeBps;
    parameters.tickDistance = tickDistance;

    state = new MockPoolTicksState();
  }
}

contract MockPoolTicksState is ProAMMPoolTicksState {
  function externalInitPoolStorage(uint160 initialSqrtP, int24 initialTick) external {
    return _initPoolStorage(initialSqrtP, initialTick);
  }

  function externalUpdatePosition(
    UpdatePositionData memory updateData,
    int24 currentTick,
    CumulativesData memory cumulatives
  ) external returns (uint256 feesClaimable, uint256 feeGrowthInside) {
    (feesClaimable, feeGrowthInside) = _updatePosition(updateData, currentTick, cumulatives);
  }

  // function externalNextInitializedTick(
  //   int24 currentTick,
  //   int24 tickSpacing,
  //   bool willUpTick
  // ) external view returns (int24 nextTick, bool initialized) {
  //   (nextTick, initialized) = nextInitializedTick(currentTick, tickSpacing, willUpTick);
  // }

  function externalUpdateLiquidityAndCrossTick(
    int24 nextTick,
    uint128 currentLiquidity,
    uint256 feeGrowthGlobal,
    uint128 secondsPerLiquidityGlobal,
    bool willUpTick
  ) external returns (uint128 newLiquidity, int24 newNextTick) {
    (newLiquidity, newNextTick) = _updateLiquidityAndCrossTick(
      nextTick,
      currentLiquidity,
      feeGrowthGlobal,
      secondsPerLiquidityGlobal,
      willUpTick
    );
  }

  function externalUpdateTickList(
    int24 tick,
    int24 previousTick,
    int24 currentTick,
    bool isAdd
  ) external {
    _updateTickList(tick, previousTick, currentTick, isAdd);
  }
}
