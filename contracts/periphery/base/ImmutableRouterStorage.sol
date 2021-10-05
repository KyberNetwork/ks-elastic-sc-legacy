// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.4;

import {IProAMMFactory} from '../../interfaces/IProAMMFactory.sol';

/// @title Immutable state
/// @notice Immutable state used by periphery contracts
abstract contract ImmutableRouterStorage {
  address public immutable factory;
  address public immutable WETH;
  bytes32 internal immutable poolInitHash;

  constructor(address _factory, address _WETH) {
    factory = _factory;
    WETH = _WETH;
    poolInitHash = IProAMMFactory(_factory).poolInitHash();
  }
}
