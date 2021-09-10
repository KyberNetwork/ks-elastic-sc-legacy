// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

interface ISnipAttack {
  struct Data {
    // timestamp of last action performed
    uint32 lastActionTime;
    // average start time of lock schedule
    uint32 lockTime;
    // average unlock time of locked fees
    uint32 unlockTime;
    // locked rToken qty since last update
    uint256 feesLocked;
  }
}
