// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

library QuadMath {
  // since our equation is ax^2 - bx + c = 0, b > 0,
  // qudratic formula to obtain the smaller root is (b - sqrt(b^2 - 4ac)) / 2a
  function getSmallerRootOfQuadEqn(
    uint256 a,
    uint256 b,
    uint256 c
  ) internal pure returns (uint256 smallerRoot) {
    smallerRoot = (b - sqrt(b * b - 4 * a * c)) / (2 * a);
  }

  // babylonian method (https://en.wikipedia.org/wiki/Methods_of_computing_square_roots#Babylonian_method)
  function sqrt(uint256 y) internal pure returns (uint256 z) {
    if (y > 3) {
      z = y;
      uint256 x = y / 2 + 1;
      while (x < z) {
        z = x;
        x = (y / x + x) / 2;
      }
    } else if (y != 0) {
      z = 1;
    }
  }
}
