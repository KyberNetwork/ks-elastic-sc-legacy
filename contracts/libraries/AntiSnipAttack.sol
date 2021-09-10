// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

import {FullMath} from './FullMath.sol';
import {LiqDeltaMath} from './LiqDeltaMath.sol';
import {MathConstants as C} from './MathConstants.sol';
import {Math} from '@openzeppelin/contracts/utils/math/Math.sol';
import {SafeCast} from './SafeCast.sol';
import {ISnipAttack} from '../interfaces/ISnipAttackData.sol';


/// @title AntiSnipAttack
/// @notice Contains the snipping attack mechanism implementation
/// to be inherited by NFT position manager
library AntiSnipAttack {
  using SafeCast for uint256;
  using SafeCast for int256;
  using SafeCast for int128;

  /// @notice Initializes values for a new position
  /// @return data Initialized snip attack data structure
  function initialize() internal view returns (ISnipAttack.Data memory data) {
    uint32 currentTime = _blockTimestamp();
    data = ISnipAttack.Data({
      lastActionTime: currentTime,
      lockTime: currentTime,
      unlockTime: currentTime,
      feesLocked: 0
    });
  }

  /// @notice Credits accumulated fees to a user's existing position
  /// @dev The posiition should already have been initialized
  /// @param self The individual position to update
  /// @param liquidityDelta The change in pool liquidity as a result of the position update
  /// this value should not be zero when called
  /// @param isAddLiquidity true = add liquidity, false = remove liquidity
  /// @param feeGrowthInsideDifference difference between position manager and an individual position
  /// in fee growth inside the tick range
  /// @param vestingPeriod The maximum time duration for which LP fees
  /// are proportionally burnt upon LP removals
  /// @return feesClaimable The claimable rToken amount to be sent to the user
  /// @return feesBurnable The rToken amount to be burnt
  function update(
    ISnipAttack.Data storage self,
    uint128 currentLiquidity,
    uint128 liquidityDelta,
    bool isAddLiquidity,
    uint256 feeGrowthInsideDifference,
    uint256 vestingPeriod
  ) internal returns (uint256 feesClaimable, uint256 feesBurnable) {
    ISnipAttack.Data memory _self = self;
    uint32 currentTime = _blockTimestamp();

    // scoping of fee proportions to avoid stack too deep
    {
      // claimable proportion (in basis pts) of collected fees between lockTime and now
      uint256 feesClaimableSinceLastActionBps = vestingPeriod == 0
        ? C.BPS
        : Math.min(C.BPS, ((currentTime - _self.lastActionTime) * C.BPS) / vestingPeriod);
      // claimable proportion (in basis pts) of locked fees
      uint256 feesClaimableVestedBps = _self.unlockTime == _self.lastActionTime
        ? 0
        : Math.min(
          C.BPS,
          ((currentTime - _self.lockTime) * C.BPS) / (_self.unlockTime - _self.lastActionTime)
        );

      uint256 feesSinceLastAction = FullMath.mulDivFloor(
        currentLiquidity,
        feeGrowthInsideDifference,
        C.TWO_POW_96
      );

      uint256 feesLockedBeforeUpdate = _self.feesLocked;
      (_self.feesLocked, feesClaimable) = calcFeeProportions(
        _self.feesLocked,
        feesSinceLastAction,
        feesClaimableVestedBps,
        feesClaimableSinceLastActionBps
      );

      // update unlock time
      // the new lock fee qty contains 2 portions:
      // (1) new lock fee qty from last action to now
      // (2) remaining lock fee qty prior to last action performed
      // new unlock time = proportionally weighted unlock times of the 2 portions
      // (1)'s unlock time = currentTime + vestingPeriod
      // (2)'s unlock time = current unlock time
      // If (1) and (2) are 0, then update to block.timestamp
      self.unlockTime = (_self.feesLocked == 0)
        ? currentTime
        : (((currentTime + vestingPeriod) *
          feesSinceLastAction *
          (C.BPS - feesClaimableSinceLastActionBps) +
          _self.unlockTime *
          feesLockedBeforeUpdate *
          (C.BPS - feesClaimableVestedBps)) / (_self.feesLocked * C.BPS))
        .toUint32();
    }

    uint256 updatedLiquidity = isAddLiquidity
      ? currentLiquidity + liquidityDelta
      : currentLiquidity - liquidityDelta;

    // adding liquidity: update average start time
    // removing liquidity: calculate and burn portion of locked fees
    if (isAddLiquidity) {
      self.lockTime = Math
      .ceilDiv(
        Math.max(_self.lockTime, currentTime - vestingPeriod) *
          uint256(currentLiquidity) +
          uint256(uint128(liquidityDelta)) *
          currentTime,
        updatedLiquidity
      ).toUint32();
    } else if (_self.feesLocked > 0) {
      feesBurnable = (_self.feesLocked * liquidityDelta) / uint256(currentLiquidity);
      _self.feesLocked -= feesBurnable;
    }

    // update other variables
    self.feesLocked = _self.feesLocked;
    self.lastActionTime = currentTime;
  }

  // for mocking
  function _blockTimestamp() internal view returns (uint32) {
    return block.timestamp.toUint32();
  }

  function calcFeeProportions(
    uint256 feesLockedCurrent,
    uint256 feesSinceLastAction,
    uint256 feesClaimableVestedBps,
    uint256 feesClaimableSinceLastActionBps
  ) internal pure returns (uint256 feesLockedNew, uint256 feesClaimable) {
    uint256 totalFees = feesLockedCurrent + feesSinceLastAction;
    feesClaimable =
      (feesClaimableVestedBps *
        feesLockedCurrent +
        feesClaimableSinceLastActionBps *
        feesSinceLastAction) /
      C.BPS;
    feesLockedNew = totalFees - feesClaimable;
  }
}
