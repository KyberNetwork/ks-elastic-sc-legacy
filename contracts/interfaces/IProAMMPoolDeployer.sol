// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.5.0;

import {IERC20, IProAMMFactory} from './IProAMMFactory.sol';

/// @title An interface for a contract that is capable of deploying ProAMM pools
/// @notice A contract deploying a ProAMM pool must implement this to pass arguments to the pool
/// @dev This is to avoid having constructor arguments in the pool contract, which results in the init code hash
/// of the pool being constant allowing the CREATE2 address of the pool to be cheaply computed on-chain
interface IProAMMPoolDeployer {
  /// @notice Get pool parameters to be used for the pool deployment
  /// @dev Called by the pool constructor to fetch the pool parameters
  /// @return factory ProAMMFactory address
  /// @return token0 First pool token by address sort order
  /// @return token1 Second pool token of the pool by address sort order
  /// @return swapFeeBps Fee to be collected upon every swap in the pool, in basis points
  /// @return tickSpacing Minimum number of ticks between initialized ticks
  function poolParams()
    external
    view
    returns (
      IProAMMFactory factory,
      IERC20 token0,
      IERC20 token1,
      uint16 swapFeeBps,
      int24 tickSpacing
    );
}
