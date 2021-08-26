// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

import {MathConstants as C} from './MathConstants.sol';
import {FullMath} from './FullMath.sol';

/// @title Contains helper functions for calculating
/// reinvestment variables, like token amount to be minted (rMintQty),
/// new reinvestment token supply and fee growth
library ReinvestmentMath {
  /// @dev calculate the mint amount with given lf, lfLast, lp and rTotalSupply
  /// contribution of lp to the increment is calculated by the proportion of lp with lf + lp
  /// then rMintQty is calculated by mutiplying this with the liquidity per reinvestment token
  /// rMintQty = rTotalSupply * (lf - lfLast) / lfLast * lp / (lp + lf)
  function calcrMintQty(
    uint256 lf,
    uint256 lfLast,
    uint128 lp,
    uint256 rTotalSupply
  ) internal pure returns (uint256 rMintQty) {
    uint256 lpContribution = FullMath.mulDivFloor(lp, lf - lfLast, lp + lf);
    rMintQty = FullMath.mulDivFloor(rTotalSupply, lpContribution, lfLast);
  }
}
