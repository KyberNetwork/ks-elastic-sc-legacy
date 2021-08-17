// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.4;

/// @title Immutable state
/// @notice Immutable state used by periphery contracts
abstract contract ImmutableStorage {
  address public immutable factory;
  address public immutable WETH;

  constructor(address _factory, address _WETH) {
    factory = _factory;
    WETH = _WETH;
  }
}
