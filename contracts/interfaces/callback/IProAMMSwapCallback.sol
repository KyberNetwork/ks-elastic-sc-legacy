// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.5.0;

/// @title Callback for IProAMMPool#swap
/// @notice Any contract that calls IProAMMPool#swap must implement this interface
interface IProAMMSwapCallback {
    /// @notice Called to `msg.sender` after swap execution of IProAMMPool#swap.
    /// @dev This function's implementation must pay tokens owed to the pool for the swap.
    /// The caller of this method must be checked to be a ProAMMPool deployed by the canonical ProAMMFactory.
    /// deltaQty0 and deltaQty1 can both be 0 if no tokens were swapped.
    /// @param deltaQty0 The token0 quantity that was sent (negative) or must be received (positive) by the pool by
    /// the end of the swap. If positive, the callback must send deltaQty0 of token0 to the pool.
    /// @param deltaQty1 The token1 quantity that was sent (negative) or must be received (positive) by the pool by
    /// the end of the swap. If positive, the callback must send deltaQty1 of token1 to the pool.
    /// @param data Data passed through by the caller via the IProAMMPool#swap call
    function proAMMSwapCallback(
        int256 deltaQty0,
        int256 deltaQty1,
        bytes calldata data
    ) external;
}