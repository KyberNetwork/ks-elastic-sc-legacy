// SPDX-License-Identifier: MIT
pragma solidity 0.8.5;

import {MathConstants} from './MathConstants.sol';
import {FullMath} from './FullMath.sol';

/// @title Contains helper functions for adding / removing liquidity
/// and amount of tokens to be minted (sMint)
library LiqMath {
  function updateReinvestments(
    uint128 lp,
    uint128 lf,
    uint256 lc,
    uint256 tokenSupply,
    uint256 feeGrowthGlobal
  ) internal pure returns (uint256 newTokenSupply, uint256 newFeeGrowthGlobal, uint256 newLf) {
    uint256 sMint = FullMath.mulDivFloor(lp, lc, lf);
    sMint = FullMath.mulDivFloor(sMint, tokenSupply, lp + lc + lf);
    newTokenSupply = tokenSupply + sMint;
    newFeeGrowthGlobal = feeGrowthGlobal + calculateFeeGrowthIncrement(sMint, lp);
    newLf = lf + lc;
  }

  function calculateFeeGrowthIncrement(
    uint256 sMint,
    uint128 lp
  ) internal pure returns (uint256) {
    return FullMath.mulDivFloor(sMint, MathConstants.TWO_POW_96, lp);
  }

  function calcSMintInLiquidityDelta(
    uint128 lf,
    uint128 lfLast,
    uint128 lp,
    uint256 tokenSupply
  ) internal pure returns (uint256 sMint) {
    sMint = FullMath.mulDivFloor(lp, lf - lfLast, lfLast);
    sMint = FullMath.mulDivFloor(sMint, tokenSupply, lp + lf);
  }
}
