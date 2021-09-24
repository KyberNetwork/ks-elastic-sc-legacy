// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

import '../ProAMMPool.sol';

contract MockProAMMPool is ProAMMPool {
  uint32 private timestamp = uint32(block.timestamp);

  function forwardTime(uint32 _amount) external {
    timestamp += _amount;
  }

  function _blockTimestamp() internal view override returns (uint32) {
    return timestamp;
  }
}
