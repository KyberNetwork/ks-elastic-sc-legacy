// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity =0.8.4;

abstract contract DeadlineValidation {
  modifier onlyNotExpired(uint256 deadline) {
    require(_blockTimestamp() <= deadline, 'ProAMM: EXPIRED');
    _;
  }

  /**
   * @dev Override this function to test easier with block timestamp
   */
  function _blockTimestamp() internal view virtual returns (uint256) {
    return block.timestamp;
  }
}
