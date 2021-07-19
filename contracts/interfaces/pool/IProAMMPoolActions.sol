// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.5.0;

import {IERC20, IProAMMFactory} from '../IProAMMFactory.sol';

interface IProAMMPoolActions {
  /// @notice Initializes most of the params for pool deployment
  /// @dev Called by the ProAMMPoolDeployer after cloning of the pool
  /// @param factory ProAMMFactory address
  /// @param token0 First pool token by address sort order
  /// @param token1 Second pool token of the pool by address sort order
  /// @param swapFeeBps Fee to be collected upon every swap in the pool, in basis points
  /// @param tickSpacing Minimum number of ticks between initialized ticks
  function initialize(
    address factory,
    IERC20 token0,
    IERC20 token1,
    uint16 swapFeeBps,
    int24 tickSpacing
  ) external;

  /// @notice Sets the initial price for the pool
  /// @param poolSqrtPrice the initial sqrt price of the pool
  function unlockPool(uint160 poolSqrtPrice) external;

  /// @notice Adds liquidity for the specifient recipient/tickLower/tickUpper position
  /// @dev Any token0 or token1 owed for the liquidity provision have to be paid for when
  /// the IProAMMMintCallback#proAMMMintCallback is called to this method's caller
  /// The quantity of token0/token1 to be sent depends on
  /// tickLower, tickUpper, the amount of liquidity, and the current price of the pool.
  /// Also sends reinvestment tokens (fees) to the recipient for any fees collected
  /// while the position is in range
  /// Reinvestment tokens have to be burnt via #burnRTokens in exchange for token0 and token1
  /// @param recipient Address for which the added liquidity is credited to
  /// @param tickLower Recipient position's lower tick
  /// @param tickUpper Recipient position's upper tick
  /// @param qty Liquidity quantity to mint
  /// @param data Data (if any) to be passed through to the callback
  /// @param qty0 The token0 quantity sent to the pool in exchange for the minted liquidity.
  /// @param qty1 The token1 quantity sent to the pool in exchange for the minted liquidity.
  function mint(
    address recipient,
    int24 tickLower,
    int24 tickUpper,
    uint128 qty,
    bytes calldata data
  ) external returns (uint256 qty0, uint256 qty1);

  /// @notice Remove liquidity from the sender
  /// Also sends reinvestment tokens (fees) to the recipient for any fees collected
  /// while the position is in range
  /// Reinvestment tokens have to be burnt via #burnRTokens in exchange for token0 and token1
  /// @param tickLower Position's lower tick for which to burn liquidity
  /// @param tickUpper Position's upper tick for which to burn liquidity
  /// @param qty Liquidity quantity to burn
  /// @return qty0 token0 quantity sent to the recipient
  /// @return qty1 token1 quantity sent to the recipient
  function burn(
    int24 tickLower,
    int24 tickUpper,
    uint128 qty
  ) external returns (uint256 qty0, uint256 qty1);

  /// @notice Burns reinvestment tokens in exchange to receive the fees collected in token0 and token1
  /// @param qty Reinvestment token quantity to burn
  /// @return qty0 token0 quantity sent to the recipient for burnt reinvestment tokens
  /// @return qty1 token1 quantity sent to the recipient for burnt reinvestment tokens
  function burnRTokens(uint256 qty) external returns (uint256 qty0, uint256 qty1);

  /// @notice Swap token0 -> token1, or vice versa
  /// @dev This method's caller receives a callback in the form of IProAMMSwapCallback#proAMMSwapCallback
  /// @param recipient The address to receive the swap output
  /// @param swapQty The swap quantity, which implicitly configures the swap as exact input (>0), or exact output (<0)
  /// @param isToken0 Whether the swapQty is specified in token0 (true) or token1 (false)
  /// @param sqrtPriceLimit For specified exact input token0 and exact output token1, this should be the minimum allowable price limit.
  /// For specified exact input token1 and exact output token0, this should be the maximum allowable price limit.
  /// @param data Any data to be passed through to the callback
  /// @return qty0 Exact token0 qty sent to recipient if < 0. Minimally received quantity if > 0.
  /// @return qty1 Exact token1 qty sent to recipient if < 0. Minimally received quantity if > 0.
  function swap(
    address recipient,
    int256 swapQty,
    bool isToken0,
    uint160 sqrtPriceLimit,
    bytes calldata data
  ) external returns (int256 qty0, int256 qty1);

  function collectGovernmentFee() external returns (uint256 governmentFeeQty);

  // /// @notice Receive token0 and/or token1 and pay it back, plus a fee, in the callback
  // /// @dev The caller of this method receives a callback in the form of IUniswapV3FlashCallback#uniswapV3FlashCallback
  // /// @dev Can be used to donate underlying tokens pro-rata to currently in-range liquidity providers by calling
  // /// with 0 amount{0,1} and sending the donation amount(s) from the callback
  // /// @param recipient The address which will receive the token0 and token1 amounts
  // /// @param qty0 The amount of token0 to send
  // /// @param qty1 The amount of token1 to send
  // /// @param data Any data to be passed through to the callback
  // function flash(
  //     address recipient,
  //     uint256 qty0,
  //     uint256 qty1,
  //     bytes calldata data
  // ) external;
}
