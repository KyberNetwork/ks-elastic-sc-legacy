// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

/// @title Provides a function for deriving a pool address from the factory, tokens, and swap fee
library PoolAddress {
  /// @notice Deterministically computes the pool address from the given data
  /// @param factory ProAMM factory address
  /// @param token0 One of the tokens constituting the token pair, regardless of order
  /// @param token1 The other token constituting the token pair, regardless of order
  /// @param swapFee Fee to be collected upon every swap in the pool, in basis points
  /// @param poolInitHash The keccak256 hash of the ProAMMPool creation code
  /// @return pool The ProAMM pool address
  function computeAddress(
    address factory,
    address token0,
    address token1,
    uint16 swapFee,
    bytes32 poolInitHash
  ) internal pure returns (address pool) {
    (token0, token1) = token0 < token1 ? (token0, token1) : (token1, token0);
    pool = address(
      uint160(
        uint256(
          keccak256(
            abi.encodePacked(
              hex'ff',
              factory,
              keccak256(abi.encode(token0, token1, swapFee)),
              poolInitHash
            )
          )
        )
      )
    );
  }
}
