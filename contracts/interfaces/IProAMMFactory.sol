// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.5.0;

import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';

/// @title The interface for the ProAMMFactory
/// @notice The ProAMMFactory facilitates creation of ProAMM pools and control over government fees
interface IProAMMFactory {
  /// @notice Emitted when a pool is created
  /// @param token0 First pool token by address sort order
  /// @param token1 Second pool token by address sort order
  /// @param swapFeeBps Fee to be collected upon every swap in the pool, in basis points
  /// @param tickSpacing Minimum number of ticks between initialized ticks
  /// @param pool The address of the created pool
  event PoolCreated(
    IERC20 indexed token0,
    IERC20 indexed token1,
    uint16 indexed swapFeeBps,
    int24 tickSpacing,
    address pool
  );

  /// @notice Emitted when a new fee is enabled for pool creation via the factory
  /// @param swapFeeBps Fee to be collected upon every swap in the pool, in basis points
  /// @param tickSpacing Minimum number of ticks between initialized ticks for pools created with the given fee
  event SwapFeeEnabled(uint16 indexed swapFeeBps, int24 indexed tickSpacing);

  /// @notice Emitted when feeToSetter changes
  /// @param oldFeeToSetter feeToSetter before the update
  /// @param newFeeToSetter feeToSetter after the update
  event FeeToSetterUpdated(address oldFeeToSetter, address newFeeToSetter);

  /// @notice Emitted when fee configuration changes
  /// @param feeTo Recipient of government fees
  /// @param governmentFeeBps Fee amount, in basis points,
  /// to be collected out of the fee charged for a pool swap
  event SetFeeConfiguration(address feeTo, uint16 governmentFeeBps); 

  /// @notice Returns the tick spacing for a specified fee.
  /// @dev A fee amount can never be removed, so this value should be hard coded or cached in the calling context
  /// @param swapFeeBps The enabled fee, denominated in hundredths of a bip. Returns 0 in case of unenabled fee
  /// @return The tick spacing
  function feeAmountTickSpacing(uint16 swapFeeBps) external view returns (int24);

  /// @notice Returns the address which can update the fee configuration
  function feeToSetter() external view returns (address);

  /// @notice Returns the contract address of the canonical implementation of the reinvestment token
  function reinvestmentTokenMaster() external view returns (address);

  /// @notice Returns the contract address of the canonical implementation of ProAMMPool
  function poolMaster() external view returns (address);

  /// @notice Fetches the recipient of government fees
  /// and current government fee charged in basis points
  function getFeeConfiguration() external view returns (address _feeTo, uint16 _governmentFeeBps);

  /// @notice Returns the pool address for a given pair of tokens and a swap fee
  /// @dev Token order does not matter
  /// @param tokenA Contract address of either token0 or token1
  /// @param tokenB Contract address of the other token
  /// @param swapFeeBps Fee to be collected upon every swap in the pool, in basis points
  /// @return pool The pool address. Returns null address if it does not exist
  function getPool(
    IERC20 tokenA,
    IERC20 tokenB,
    uint16 swapFeeBps
  ) external view returns (address pool);

  /// @notice Creates a pool for the given two tokens and fee
  /// @param tokenA One of the two tokens in the desired pool
  /// @param tokenB The other of the two tokens in the desired pool
  /// @param swapFeeBps Desired swap fee for the pool, in basis points
  /// @dev Token order does not matter. tickSpacing is determined from the fee.
  /// Call will revert under any of these conditions:
  ///     1) pool already exists
  ///     2) invalid swap fee
  ///     3) invalid token arguments
  /// @return pool The address of the newly created pool
  function createPool(
    IERC20 tokenA,
    IERC20 tokenB,
    uint16 swapFeeBps
  ) external returns (address pool);

  /// @notice Enables a fee amount with the given tickSpacing
  /// @dev Fee amounts may never be removed once enabled
  /// @param swapFeeBps The fee amount to enable, in basis points
  /// @param tickSpacing The spacing between ticks to be enforced for all pools created with the given fee amount
  function enableSwapFee(uint16 swapFeeBps, int24 tickSpacing) external;

  /// @notice Updates the address which can update the fee configuration
  /// @dev Must be called by the current feeToSetter
  function updateFeeToSetter(address) external;

  /// @notice Updates the address receiving government fees and fee quantity
  /// @dev Only feeToSetter is able to perform the update
  /// @param feeTo Address to receive government fees collected from pools
  /// @param governmentFeeBps Fee amount, in basis points,
  /// to be collected out of the fee charged for a pool swap
  function setFeeConfiguration(address feeTo, uint16 governmentFeeBps) external;
}
