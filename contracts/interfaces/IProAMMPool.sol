// // SPDX-License-Identifier: agpl-3.0
// pragma solidity >=0.5.0;

// import {IERC20Ext} from '@kyber.network/utils-sc/contracts/IERC20Ext.sol';

// interface IProAMMPool {
//     /// @notice The contract that deployed the pool, which must adhere to the IProAMMFactory interface
//     /// @return The contract address
//     function factory() external view returns (address);

//     /// @notice The first of the two tokens of the pool, sorted by address
//     /// @return The token contract address
//     function token0() external view returns (IERC20Ext);

//     /// @notice The second of the two tokens of the pool, sorted by address
//     /// @return The token contract address
//     function token1() external view returns (IERC20Ext);

//     /// @notice The pool's fee in basis points
//     /// @return The fee in basis points
//     function feeInBps() external view returns (uint16);

//     /// @notice The pool tick spacing
//     /// @dev Tick can only be initialized and used at multiples of this value
//     /// It remains an int24 to avoid casting even though it is >= 1.
//     /// e.g: a tickSpacing of 3 means ticks can be initialized every 3rd tick, i.e., ..., -6, -3, 0, 3, 6, ...
//     /// @return The tick spacing
//     function tickSpacing() external view returns (int24);

//     /// @notice The maximum amount of position liquidity that can use any tick in the range
//     /// @dev This parameter is enforced per tick to prevent liquidity from overflowing a uint128 at any point, and
//     /// also prevents out-of-range liquidity from being used to prevent adding in-range liquidity to a pool
//     /// @return The max amount of liquidity per tick
//     function maxLiquidityPerTick() external view returns (uint128);
// }
