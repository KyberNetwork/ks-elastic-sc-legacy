// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

import '../libraries/BitMath.sol';
import './EchidnaAssert.sol';

contract BitMathEchidnaTest is EchidnaAssert {
  function mostSignificantBitInvariant(uint256 input) external {
    uint8 msb = BitMath.mostSignificantBit(input);
    isTrue(input >= (uint256(2)**msb));
    isTrue(msb == 255 || input < uint256(2)**(msb + 1));
  }

  function leastSignificantBitInvariant(uint256 input) external {
    uint8 lsb = BitMath.leastSignificantBit(input);
    isTrue(input & (uint256(2)**lsb) != 0);
    isTrue(input & (uint256(2)**lsb - 1) == 0);
  }
}
