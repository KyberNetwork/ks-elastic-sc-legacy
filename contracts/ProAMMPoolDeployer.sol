// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.5;

import {IERC20, IProAMMFactory, IProAMMPoolDeployer} from './interfaces/IProAMMPoolDeployer.sol';
import {ProAMMPool} from './ProAMMPool.sol';

contract ProAMMPoolDeployer is IProAMMPoolDeployer {
  struct PoolParams {
    IProAMMFactory factory;
    IERC20 token0;
    IERC20 token1;
    uint16 swapFeeBps;
    int24 tickSpacing;
  }

  PoolParams public override poolParams;

  /// @dev Deploys a pool with the given parameters by transiently setting the parameters storage slot,
  /// then clearing it after deploying the pool.
  /// @param factory ProAMMFactory address, will be casted to IProAMMFactory
  /// @param token0 First pool token by address sort order
  /// @param token1 Second pool token of the pool by address sort order
  /// @param swapFeeBps Fee to be collected upon every swap in the pool, in basis points
  /// @param tickSpacing Minimum number of ticks between initialized ticks
  function deploy(
    address factory,
    IERC20 token0,
    IERC20 token1,
    uint16 swapFeeBps,
    int24 tickSpacing
  ) internal returns (address pool) {
    poolParams = PoolParams({
      factory: IProAMMFactory(factory),
      token0: token0,
      token1: token1,
      swapFeeBps: swapFeeBps,
      tickSpacing: tickSpacing
    });
    pool = address(new ProAMMPool{salt: keccak256(abi.encode(token0, token1, swapFeeBps))}());
    delete poolParams;
  }
}
