// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.5.0;

import {IERC20, IProAMMFactory} from './IProAMMFactory.sol';
import {IReinvestmentToken} from './IReinvestmentToken.sol';
import {IProAMMPoolActions} from './pool/IProAMMPoolActions.sol';
import {IProAMMPoolEvents} from './pool/IProAMMPoolEvents.sol';

interface IProAMMPool is IProAMMPoolActions, IProAMMPoolEvents {
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
      uint256 poolReinvestmentLiquidity,
      uint256 poolReinvestmentLiquidityLast
    );

  /// @return the total amount of LP fees collected for governance (Eg. KyberDAO)
  function collectedGovernmentFee() external view returns (uint256);

  /// @notice Look up information about a specific tick in the pool
  /// @param tick The tick to look up
  /// @return liquidityGross the total amount of position liquidity 
  /// that uses the pool either as tick lower or tick upper
  /// liquidityNet how much liquidity changes when the pool tick crosses above the tick
  /// feeGrowthOutside the fee growth on the other side of the tick from the current tick
  /// initialized True iff liquidityGross is greater than 0, otherwise equal to false.
  function ticks(int24 tick)
    external
    view
    returns (
      uint128 liquidityGross,
      int128 liquidityNet,
      uint256 feeGrowthOutside,
      bool initialized
    );

  /// @notice Returns 256 packed tick initialized boolean values. See TickBitmap for more information
  function tickBitmap(int16 wordPosition) external view returns (uint256);

  /// @notice Returns the information about a position by the position's key
  /// @param key keccak256(abi.encodePacked(owner, tickLower, tickUpper))
  /// @return liquidity liquidity quantity of the position
  /// @return feeGrowthInsideLast fee growth inside the tick range as of the last mint / burn action performed
  function positions(bytes32 key)
    external
    view
    returns (uint128 liquidity, uint256 feeGrowthInsideLast);
}
