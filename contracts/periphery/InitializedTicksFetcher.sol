// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.9;
pragma abicoder v2;

import {IPoolStorage} from '../interfaces/pool/IPoolStorage.sol';
import {TickMath as T} from '../libraries/TickMath.sol';

contract InitializedTicksFetcher {
  /// @dev Simplest method that attempts to fetch all initialized ticks
  /// Has the highest probability of running out of gas
  function getAllTicks(IPoolStorage pool) external view returns (int24[] memory allTicks) {
    // + 3 because of MIN_TICK, 0 and MAX_TICK
    uint32 maxNumTicks = uint32((uint256(int256(T.MAX_TICK / pool.tickDistance()))) * 2 + 3);
    allTicks = new int24[](maxNumTicks);
    int24 currentTick = T.MIN_TICK;
    allTicks[0] = currentTick;
    uint32 i = 1;
    while (currentTick < T.MAX_TICK) {
      (, currentTick) = pool.initializedTicks(currentTick);
      allTicks[i] = currentTick;
      i++;
    }
  }

  /// @dev Fetches all initialized ticks with a specified startTick (searches uptick)
  /// @dev 0 length = Use maximum length
  function getTicksInRange(
    IPoolStorage pool,
    int24 startTick,
    uint32 length
  ) external view returns (int24[] memory allTicks) {
    (int24 previous, int24 next) = pool.initializedTicks(startTick);
    // startTick is uninitialized, return
    if (previous == 0 && next == 0) return allTicks;
    // calculate num ticks from starting tick
    uint32 maxNumTicks;
    if (length == 0) {
      maxNumTicks = uint32(uint256(int256((T.MAX_TICK - startTick) / pool.tickDistance())));
      if (startTick == 0 || startTick == T.MAX_TICK) {
        maxNumTicks++;
      }
    } else {
      maxNumTicks = length;
    }

    allTicks = new int24[](maxNumTicks);
    for (uint32 i = 0; i < maxNumTicks; i++) {
      allTicks[i] = startTick;
      if (startTick == T.MAX_TICK) break;
      (, startTick) = pool.initializedTicks(startTick);
    }
  }

  function getNearestInitializedTicks(IPoolStorage pool, int24 tick)
    external
    view
    returns (int24 previous, int24 next)
  {
    // if queried tick already initialized, fetch and return values
    (previous, next) = pool.initializedTicks(tick);
    if (previous != 0 || next != 0) return (previous, next);

    // search downtick from MAX_TICK
    if (tick > 0) {
      previous = T.MAX_TICK;
      while (previous > tick) {
        (previous, ) = pool.initializedTicks(previous);
      }
      (, next) = pool.initializedTicks(previous);
    } else {
      // search uptick from MIN_TICK
      next = T.MIN_TICK;
      while (next < tick) {
        (, next) = pool.initializedTicks(next);
      }
      (previous, ) = pool.initializedTicks(next);
    }
  }
}
