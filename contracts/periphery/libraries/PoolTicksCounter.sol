// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import {IProAMMPool} from '../../interfaces/IProAMMPool.sol';

import 'hardhat/console.sol';

library PoolTicksCounter {
  /// @dev This function counts the number of initialized ticks that would incur a gas cost between tickBefore and tickAfter.
  /// When tickBefore and/or tickAfter themselves are initialized, the logic over whether we should count them depends on the
  /// direction of the swap. If we are swapping upwards (tickAfter > tickBefore) we don't want to count tickBefore but we do
  /// want to count tickAfter. The opposite is true if we are swapping downwards.
  function countInitializedTicksCrossed(
    IProAMMPool self,
    int24 tickBefore,
    int24 tickAfter
  ) internal view returns (uint32 initializedTicksCrossed) {
    int16 wordPosLower;
    int16 wordPosHigher;
    uint8 bitPosLower;
    uint8 bitPosHigher;
    bool tickBeforeInitialized;
    bool tickAfterInitialized;

    {
      int24 tickSpacing = self.tickSpacing();
      int16 wordPos;
      uint8 bitPos;
      (wordPos, bitPos, tickBeforeInitialized) = position(self, tickBefore, tickSpacing);
      int16 wordPosAfter;
      uint8 bitPosAfter;
      (wordPosAfter, bitPosAfter, tickAfterInitialized) = position(self, tickAfter, tickSpacing);

      if (tickBefore <= tickAfter) {
        wordPosLower = wordPos;
        bitPosLower = bitPos;
        wordPosHigher = wordPosAfter;
        bitPosHigher = bitPosAfter;
      } else {
        wordPosLower = wordPosAfter;
        bitPosLower = bitPosAfter;
        wordPosHigher = wordPos;
        bitPosHigher = bitPos;
      }
    }

    // Count the number of initialized ticks crossed by iterating through the tick bitmap.
    // Our first mask should include the lower tick and everything to its left.
    uint256 mask = type(uint256).max << bitPosLower;
    while (wordPosLower <= wordPosHigher) {
      // If we're on the final tick bitmap page, ensure we only count up to our
      // ending tick.
      if (wordPosLower == wordPosHigher) {
        mask = mask & (type(uint256).max >> (255 - bitPosHigher));
      }

      uint256 masked = self.tickBitmap(wordPosLower) & mask;
      initializedTicksCrossed += countOneBits(masked);
      wordPosLower++;
      // Reset our mask so we consider all bits on the next iteration.
      mask = type(uint256).max;
    }

    // In the case where tickAfter is initialized, we only want to count it if we are swapping downwards.
    if (tickAfterInitialized && tickBefore > tickAfter) {
      initializedTicksCrossed -= 1;
    }

    // In the case where tickBefore is initialized, we only want to count it if we are swapping upwards.
    if (tickBeforeInitialized && tickBefore < tickAfter) {
      initializedTicksCrossed -= 1;
    }

    return initializedTicksCrossed;
  }

  function position(
    IProAMMPool self,
    int24 tick,
    int24 tickSpacing
  )
    private
    view
    returns (
      int16 wordPos,
      uint8 bitPos,
      bool isInitialized
    )
  {
    int24 compressed = tick / tickSpacing;
    // in case tick is negative, we must round down 
    // -5 / 4 = -1 (we expected compress = -2)
    if (tick < 0 && tick % tickSpacing != 0) compressed--;
    wordPos = int16(compressed >> 8);
    bitPos = uint8(int8(compressed % 256));
    isInitialized = self.tickBitmap(wordPos) & (1 << bitPos) > 0;
  }

  function countOneBits(uint256 x) private pure returns (uint16) {
    uint16 bits = 0;
    while (x != 0) {
      bits++;
      x &= (x - 1);
    }
    return bits;
  }
}
