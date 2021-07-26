// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import '../libraries/TickBitmap.sol';

contract MockTickBitmap {
  using TickBitmap for mapping(int16 => uint256);

  mapping(int16 => uint256) public bitmap;

  function flipTick(int24 tick) external {
    bitmap.flipTick(tick, 1);
  }

  function getGasCostOfFlipTick(int24 tick) external returns (uint256) {
    uint256 gasBefore = gasleft();
    bitmap.flipTick(tick, 1);
    return gasBefore - gasleft();
  }

  function nextInitializedTickWithinOneWord(int24 tick, bool willUpTick)
    external
    view
    returns (int24 next, bool initialized)
  {
    return bitmap.nextInitializedTickWithinOneWord(tick, 1, willUpTick);
  }

  function getGasCostOfNextInitializedTickWithinOneWord(int24 tick, bool willUpTick)
    external
    view
    returns (uint256)
  {
    uint256 gasBefore = gasleft();
    bitmap.nextInitializedTickWithinOneWord(tick, 1, willUpTick);
    return gasBefore - gasleft();
  }

  // returns whether the given tick is initialized
  function isInitialized(int24 tick) external view returns (bool) {
    (int24 next, bool initialized) = bitmap.nextInitializedTickWithinOneWord(tick, 1, false);
    return next == tick ? initialized : false;
  }
}
