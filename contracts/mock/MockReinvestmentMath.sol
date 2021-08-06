// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

import '../libraries/ReinvestmentMath.sol';

contract MockReinvestmentMath {
  function calcrMintQtyInLiquidityDelta(
    uint256 lf,
    uint256 lfLast,
    uint128 lp,
    uint256 rTotalSupply
  ) external pure returns (uint256) {
    return ReinvestmentMath.calcrMintQtyInLiquidityDelta(lf, lfLast, lp, rTotalSupply);
  }
}
