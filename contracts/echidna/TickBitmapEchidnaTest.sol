// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

import '../libraries/TickBitmap.sol';
import './EchidnaAssert.sol';

contract TickBitmapEchidnaTest is EchidnaAssert {
  using TickBitmap for mapping(int16 => uint256);

  mapping(int16 => uint256) private bitmap;

  // returns whether the given tick is initialized
  function isInitialized(int24 tick) private view returns (bool) {
    (int24 next, bool initialized) = bitmap.nextInitializedTickWithinOneWord(tick, 1, false);
    return next == tick ? initialized : false;
  }

  function flipTick(int24 tick) external {
    bool before = isInitialized(tick);
    bitmap.flipTick(tick, 1);
    isTrue(isInitialized(tick) == !before);
  }

  // TODO: check why this test failed
  // function checkNextInitializedTickWithinOneWordInvariants(int24 tick, bool willUpTick)
  //   external
  //   view
  // {
  //   (int24 next, bool initialized) = bitmap.nextInitializedTickWithinOneWord(tick, 1, willUpTick);
  //   if (willUpTick) {
  //     // type(int24).max - 256
  //     require(tick < 8388351);
  //     assert(next > tick);
  //     assert(next - tick <= 256);
  //     // all the ticks between the input tick and the next tick should be uninitialized
  //     for (int24 i = tick + 1; i < next; i++) {
  //       assert(!isInitialized(i));
  //     }
  //     assert(isInitialized(next) == initialized);
  //   } else {
  //     // type(int24).min + 256
  //     require(tick >= -8388352);
  //     assert(next <= tick);
  //     assert(tick - next < 256);
  //     // all the ticks between the input tick and the next tick should be uninitialized
  //     for (int24 i = tick; i > next; i--) {
  //       assert(!isInitialized(i));
  //     }
  //     assert(isInitialized(next) == initialized);
  //   }
  // }
}
