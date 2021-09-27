// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

/// @title Callback for IProAMMPool#flash
/// @notice Any contract that calls IProAMMPool#flash must implement this interface
interface IProAMMFlashCallback {
  /// @notice Called to `msg.sender` after flash loaning to the recipient from IProAMMPool#flash.
  /// @dev This function's implementation must send the loaned amounts with computed fee amounts
  /// The caller of this method must be checked to be a ProAMMPool deployed by the canonical ProAMMFactory.
  /// @param feeQty0 The token0 fee to be sent to the pool.
  /// @param feeQty1 The token1 fee to be sent to the pool.
  /// @param data Data passed through by the caller via the IProAMMPool#flash call
  function proAMMFlashCallback(
    uint256 feeQty0,
    uint256 feeQty1,
    bytes calldata data
  ) external;
}
