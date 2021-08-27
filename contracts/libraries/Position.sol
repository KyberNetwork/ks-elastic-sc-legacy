// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

import {FullMath} from './FullMath.sol';
import {LiqDeltaMath} from './LiqDeltaMath.sol';
import {MathConstants as C} from './MathConstants.sol';

/// @title Position
/// @notice Positions represent an owner's liquidity within specified tick boundaries
library Position {
  // data stored for each user's position
  struct Data {
    // the amount of liquidity owned by this position
    uint128 liquidity;
    // fee growth per unit of liquidity as of the last update to liquidity
    uint256 feeGrowthInsideLast;
  }

  /// @notice Returns the Info struct of a position, given an owner and position boundaries
  /// @param self The mapping containing all user positions
  /// @param owner The address of the position owner
  /// @param tickLower The lower tick boundary of the position
  /// @param tickUpper The upper tick boundary of the position
  /// @return position The position info struct of the given owners' position
  function get(
    mapping(bytes32 => Data) storage self,
    address owner,
    int24 tickLower,
    int24 tickUpper
  ) internal view returns (Position.Data storage position) {
    position = self[keccak256(abi.encodePacked(owner, tickLower, tickUpper))];
  }

  /// @notice Credits accumulated fees to position manager's position
  /// @param liquidityDelta The change in pool liquidity as a result of the position update
  /// this value should not be zero when called
  /// @param feeGrowthInside The all-time fee growth in LP tokens, per unit of liquidity, inside the position's tick boundaries
  /// @return feesClaimable The claimable rToken amount to be sent to the user
  function update(
    Data storage self,
    int128 liquidityDelta,
    uint256 feeGrowthInside
  ) internal returns (uint256 feesClaimable) {
    Data memory _self = self;
    // calculate accumulated fees for current liquidity
    // (ie. does not include liquidityDelta)
    feesClaimable = FullMath.mulDivFloor(
      feeGrowthInside - _self.feeGrowthInsideLast,
      _self.liquidity,
      C.TWO_POW_96
    );
    // update the position
    self.liquidity = LiqDeltaMath.addLiquidityDelta(_self.liquidity, liquidityDelta);
    self.feeGrowthInsideLast = feeGrowthInside;
  }
}
