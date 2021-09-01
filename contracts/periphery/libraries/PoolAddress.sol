// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import {IProAMMFactory} from '../../interfaces/IProAMMFactory.sol';

/// @title Provides functions for deriving a pool address from the factory, tokens, and the fee
library PoolAddress {
  //   bytes32 internal constant POOL_INIT_CODE_HASH =
  //     0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54;

  /// @notice Deterministically computes the pool address given the factory and params
  /// @param factory The Uniswap V3 factory contract address
  /// @return pool The contract address of the V3 pool
  function computeAddress(
    address factory,
    address token0,
    address token1,
    uint16 feeBps
  ) internal view returns (address pool) {
    return IProAMMFactory(factory).getPool(token0, token1, feeBps);
    // TODO use calulating create2 address
    // pool = address(
    //   uint256(
    //     keccak256(
    //       abi.encodePacked(
    //         hex'ff',
    //         factory,
    //         keccak256(abi.encode(token0, token1, feeBps)),
    //         POOL_INIT_CODE_HASH
    //       )
    //     )
    //   )
    // );
  }
}
