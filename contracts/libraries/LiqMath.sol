// SPDX-License-Identifier: MIT
pragma solidity 0.8.5;

import './FullMath.sol';

/// @title Contains helper functions for adding / removing liquidity
/// and amount of tokens to be minted (sMint)
library LiqMath {
  function calcSMintInSwap(
    uint128 lp,
    uint128 lf,
    uint128 lc,
    uint256 tokenSupply
  ) external pure returns (uint256 sMint) {
    sMint = FullMath.mulDivFloor(lp, lc, lf);
    sMint = FullMath.mulDivFloor(sMint, tokenSupply, lp + lc + lf);
  }

  function calcSMintInLiquidityDelta(
    uint128 lf,
    uint128 lfLast,
    uint128 lp,
    uint256 tokenSupply
  ) external pure returns (uint256 sMint) {
    sMint = FullMath.mulDivFloor(lp, lf - lfLast, lfLast);
    sMint = FullMath.mulDivFloor(sMint, tokenSupply, lp + lf);
  }
}
