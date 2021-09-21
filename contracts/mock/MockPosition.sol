// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

import '../libraries/Position.sol';

contract MockPosition {
  using Position for mapping(bytes32 => Position.Data);
  using Position for Position.Data;
  mapping(bytes32 => Position.Data) private positions;
  uint256 public feesClaimable;

  function get(
    address owner,
    int24 tickLower,
    int24 tickUpper
  ) external view returns (Position.Data memory position) {
    return positions.get(owner, tickLower, tickUpper);
  }

  function update(
    address owner,
    int24 tickLower,
    int24 tickUpper,
    int128 liquidityDelta,
    uint256 feeGrowthInside
  ) external {
    Position.Data storage position = positions.get(owner, tickLower, tickUpper);
    feesClaimable = position.update(liquidityDelta, feeGrowthInside);
  }
}
