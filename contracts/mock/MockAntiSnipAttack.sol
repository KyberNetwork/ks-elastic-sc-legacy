// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

import '../libraries/AntiSnipAttack.sol';

contract MockAntiSnipAttack {
  struct Fees {
    uint256 feesClaimable;
    uint256 feesBurnable;
  }
  ISnipAttack.Data public data;
  uint32 public timestamp;
  Fees public fees;

  function initialize() external {
    data = AntiSnipAttack.initialize();
    _updateTimestamp();
  }

  function update(
    uint128 currentLiquidity,
    uint128 liquidityDelta,
    bool isAddLiquidity,
    uint256 feeGrowthInsideDifference,
    uint256 vestingPeriod
  ) external {
    (fees.feesClaimable, fees.feesBurnable) = AntiSnipAttack.update(
      data,
      currentLiquidity,
      liquidityDelta,
      isAddLiquidity,
      feeGrowthInsideDifference,
      vestingPeriod
    );
    _updateTimestamp();
  }

  function snip(
    uint128 currentLiquidity,
    uint128 liquidityDelta,
    uint256 feeGrowthInsideDifference,
    uint256 vestingPeriod
  ) external {
    AntiSnipAttack.update(
      data,
      currentLiquidity,
      liquidityDelta,
      true,
      feeGrowthInsideDifference,
      vestingPeriod
    );
    (fees.feesClaimable, fees.feesBurnable) = AntiSnipAttack.update(
      data,
      currentLiquidity,
      liquidityDelta,
      false,
      feeGrowthInsideDifference,
      vestingPeriod
    );
    _updateTimestamp();
  }

  function calcFeeProportions(
    uint256 feesLockedCurrent,
    uint256 feesSinceLastAction,
    uint256 feesClaimableVestedBps,
    uint256 feesClaimableSinceLastActionBps
  ) external pure returns (uint256 feesLockedNew, uint256 feesClaimable) {
    return
      AntiSnipAttack.calcFeeProportions(
        feesLockedCurrent,
        feesSinceLastAction,
        feesClaimableVestedBps,
        feesClaimableSinceLastActionBps
      );
  }

  function _updateTimestamp() internal {
    timestamp = uint32(block.timestamp);
  }
}
