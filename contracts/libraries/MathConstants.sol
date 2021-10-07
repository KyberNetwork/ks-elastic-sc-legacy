// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

/// @title Contains constants needed for math libraries
library MathConstants {
  uint256 internal constant TWO_BPS = 20_000;
  uint256 internal constant TWO_POW_96 = 2**96;
  uint8 internal constant RES_96 = 96;
  uint24 internal constant BPS = 10000;
  int24 internal constant MAX_TICK_DISTANCE = 487; // ~5% price movement
  // max number of tick travel when inserting if data changes
  uint256 internal constant MAX_TICK_TRAVEL = 10;
}
