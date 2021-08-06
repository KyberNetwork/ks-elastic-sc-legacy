// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

import {MathConstants} from './MathConstants.sol';
import {FullMath} from './FullMath.sol';

/// @title Contains helper functions for calculating
/// reinvestment variables, like token amount to be minted (rMintQty),
/// new reinvestment token supply and fee growth
library ReinvestmentMath {
  /// rMintQty = tokenSupply * lp * lc / (lf * (lp + lc + lf))
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
    newFeeGrowthGlobal = feeGrowthGlobal;
    if (lp != 0) {
      newFeeGrowthGlobal += FullMath.mulDivFloor(rMintQty, MathConstants.TWO_POW_96, lp);
    }
    newLf = lf + lc;
  }

  /// @dev calculate the mint amount with given lf, lfLast, lp and rTotalSupply
  /// contribution of lp to the incrediment is calulated by the porpotion of lp with lf + lp
  /// then rMintQty is calculated by mutiplying this with the liquidity per reinvestment token
  /// rMintQty = rTotalSupply * (lf - lfLast) / lfLast * lp /(lp + lf)
  function calcrMintQtyInLiquidityDelta(
    uint256 lf,
    uint256 lfLast,
    uint128 lp,
    uint256 rTotalSupply
  ) internal pure returns (uint256 rMintQty) {
    uint256 lpContribution = FullMath.mulDivFloor(lp, lf - lfLast, lp + lf);
    rMintQty = FullMath.mulDivFloor(rTotalSupply, lpContribution, lfLast);
  }
}
