// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

import {IERC20, IProAMMFactory} from './IProAMMFactory.sol';
import {IReinvestmentToken} from './IReinvestmentToken.sol';
import {IProAMMPoolActions} from './pool/IProAMMPoolActions.sol';
import {IProAMMPoolEvents} from './pool/IProAMMPoolEvents.sol';
import {IPoolStorage} from './IPoolStorage.sol';


interface IProAMMPool is IProAMMPoolActions, IProAMMPoolEvents, IPoolStorage {

  /// @notice Fetches the pool's current price, tick and liquidity
  /// @return poolSqrtPrice pool's current price: sqrt(token1/token0)
  /// @return poolTick pool's current tick
  /// @return locked true if pool is locked, false otherwise
  /// @return poolLiquidity pool's current liquidity that is in range
  function getPoolState()
    external
    view
    returns (
      uint160 poolSqrtPrice,
      int24 poolTick,
      bool locked,
      uint128 poolLiquidity
    );

  /// @notice Fetches the pool's feeGrowthGlobal, reinvestment liquidity and its last cached value
  /// @return poolFeeGrowthGlobal pool's fee growth in LP fees (reinvestment tokens) collected per unit of liquidity since pool creation
  /// @return poolReinvestmentLiquidity total liquidity from collected LP fees (reinvestment tokens) that are reinvested into the pool
  /// @return poolReinvestmentLiquidityLast last cached total liquidity from collected fees
  /// This value will differ from poolReinvestmentLiquidity when swaps that won't result in tick crossings occur
  function getReinvestmentState()
    external
    view
    returns (
      uint256 poolFeeGrowthGlobal,
      uint128 poolReinvestmentLiquidity,
      uint128 poolReinvestmentLiquidityLast
    );

  /// @notice Calculates and returns the active time per unit of liquidity
  /// @param tickLower The lower tick (of a position)
  /// @param tickUpper The upper tick (of a position)
  /// @return secondsPerLiquidityInside active time (multiplied by 2^96)
  /// between the 2 ticks, per unit of liquidity.
  function getSecondsPerLiquidityInside(int24 tickLower, int24 tickUpper)
    external
    view
    returns (uint128 secondsPerLiquidityInside);
}
