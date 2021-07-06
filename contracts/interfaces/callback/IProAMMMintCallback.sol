// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.5.0;

/// @title Callback for IProAMMPool#mint
/// @notice Any contract that calls IProAMMPool#mint must implement this interface
interface IProAMMMintCallback {
    /// @notice Called to `msg.sender` after minting liquidity via IProAMMPool#mint.
    /// @dev This function's implementation must send pool tokens to the pool for the minted LP tokens.
    /// The caller of this method must be checked to be a ProAMMPool deployed by the canonical ProAMMFactory.
    /// @param deltaQty0 The token0 quantity to be sent to the pool.
    /// @param deltaQty1 The token1 quantity to be sent to the pool.
    /// @param data Data passed through by the caller via the IProAMMPool#mint call
    function proAMMMintCallback(
        uint256 deltaQty0,
        uint256 deltaQty1,
        bytes calldata data
    ) external;
}
