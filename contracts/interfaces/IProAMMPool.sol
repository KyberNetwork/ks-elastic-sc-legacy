// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

import {IERC20, IProAMMFactory} from './IProAMMFactory.sol';
import {IReinvestmentToken} from './IReinvestmentToken.sol';
import {IProAMMPoolActions} from './pool/IProAMMPoolActions.sol';
import {IProAMMPoolEvents} from './pool/IProAMMPoolEvents.sol';
import {IProAMMPoolTicksState} from './pool/IProAMMPoolTicksState.sol';

interface IProAMMPool is IProAMMPoolActions, IProAMMPoolEvents, IProAMMPoolTicksState {
  /// @notice The contract that deployed the pool, which must adhere to the IProAMMFactory interface
  /// @return The contract address
  function factory() external view returns (IProAMMFactory);

  /// @notice The first of the two tokens of the pool, sorted by address
  /// @return The token contract address
  function token0() external view returns (IERC20);

  /// @notice The second of the two tokens of the pool, sorted by address
  /// @return The token contract address
  function token1() external view returns (IERC20);

  /// @notice The reinvestment token of the pool
  /// @dev Used for to handle accounting of reinvestment of swap fees collected
  /// @return The reinvestment token contract address
  function reinvestmentToken() external view returns (IReinvestmentToken);

  /// @notice The pool's fee in basis points
  /// @return The fee in basis points
  function swapFeeBps() external view returns (uint16);

  /// @notice The pool tick spacing
  /// @dev Tick can only be initialized and used at multiples of this value
  /// It remains an int24 to avoid casting even though it is >= 1.
  /// e.g: a tickSpacing of 5 means ticks can be initialized every 5th tick, i.e., ..., -10, -5, 0, 5, 10, ...
  /// @return The tick spacing
  function tickSpacing() external view returns (int24);

  /// @notice The maximum amount of position liquidity that can use any tick in the range
  /// @dev This parameter is enforced per tick to prevent liquidity from overflowing a uint128 at any point, and
  /// also prevents out-of-range liquidity from being used to prevent adding in-range liquidity to a pool
  /// @return The max amount of liquidity per tick
  function maxLiquidityPerTick() external view returns (uint128);

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
}
