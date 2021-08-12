// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

import {MathConstants} from './MathConstants.sol';
import {FullMath} from './FullMath.sol';

/// @title Contains helper functions for calculating
/// reinvestment variables, like token amount to be minted (rMintQty),
/// new reinvestment token supply and fee growth
library ReinvestmentMath {
  function updateReinvestments(
    uint128 lp,
    uint256 lf,
    uint256 lc,
    uint256 tokenSupply,
    uint256 feeGrowthGlobal
  )
    internal
    pure
    returns (
      uint256 newTokenSupply,
      uint256 newFeeGrowthGlobal,
      uint256 newLf
    )
  {
    uint256 rMintQty = FullMath.mulDivFloor(lp, lc, lf);
    rMintQty = FullMath.mulDivFloor(rMintQty, tokenSupply, lp + lc + lf);
    newTokenSupply = tokenSupply + rMintQty;
    newFeeGrowthGlobal = feeGrowthGlobal + calcFeeGrowthIncrement(rMintQty, lp);
    newLf = lf + lc;
  }

  function calcFeeGrowthIncrement(uint256 rMintQty, uint128 lp) internal pure returns (uint256) {
    if (lp == 0) return 0;
    return FullMath.mulDivFloor(rMintQty, MathConstants.TWO_POW_96, lp);
  }

  function calcrMintQty(
    uint256 lf,
    uint256 lfLast,
    uint128 lp,
    uint256 tokenSupply
  ) internal pure returns (uint256 rMintQty) {
    rMintQty = FullMath.mulDivFloor(lp, lf - lfLast, lfLast);
    rMintQty = FullMath.mulDivFloor(rMintQty, tokenSupply, lp + lf);
  }

  function calcLfDelta(
    uint256 burnAmount,
    uint256 lf,
    uint256 tokenSupply
  ) internal pure returns (uint256 lfDelta) {
    lfDelta = FullMath.mulDivFloor(burnAmount, lf, tokenSupply);
  }
}
