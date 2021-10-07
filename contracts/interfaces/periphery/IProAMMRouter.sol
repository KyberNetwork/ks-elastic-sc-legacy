// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.8.0;
pragma abicoder v2;

import '../callback/IProAMMSwapCallback.sol';

/// @notice Functions for swapping tokens via Pro-AMM v2
interface IProAMMRouter is IProAMMSwapCallback {
  struct ExactInputSingleParams {
    address tokenIn;
    address tokenOut;
    uint16 fee;
    address recipient;
    uint256 deadline;
    uint256 amountIn;
    uint256 minAmountOut;
    uint160 sqrtPriceLimitX96;
  }

  /// @notice Swaps `amountIn` of one token for as much as possible of another token
  /// @param params The parameters necessary for the swap, encoded as `ExactInputSingleParams` in calldata
  /// @return amountOut The amount of the received token
  function swapExactInputSingle(ExactInputSingleParams calldata params)
    external
    payable
    returns (uint256 amountOut);

  /// @dev If the swap is from token0 -> token1 -> token2, then path is encoded as [token0, fee01, token1, fee12, token2]
  struct ExactInputParams {
    bytes path;
    address recipient;
    uint256 deadline;
    uint256 amountIn;
    uint256 minAmountOut;
  }

  /// @notice Swaps `amountIn` of one token for as much as possible of another along the specified path
  /// @param params The parameters necessary for the multi-hop swap, encoded as `ExactInputParams` in calldata
  /// @return amountOut The amount of the received token
  function swapExactInput(ExactInputParams calldata params)
    external
    payable
    returns (uint256 amountOut);

  struct ExactOutputSingleParams {
    address tokenIn;
    address tokenOut;
    uint16 fee;
    address recipient;
    uint256 deadline;
    uint256 amountOut;
    uint256 maxAmountIn;
    uint160 sqrtPriceLimitX96;
  }

  /// @notice Swaps as little as possible of one token for `amountOut` of another token
  /// @param params The parameters necessary for the swap, encoded as `ExactOutputSingleParams` in calldata
  /// @return amountIn The amount of the input token
  function swapExactOutputSingle(ExactOutputSingleParams calldata params)
    external
    payable
    returns (uint256 amountIn);

  /// @dev If the swap is from token0 -> token1 -> token2, then path is encoded as [token2, fee12, token1, fee01, token0]
  struct ExactOutputParams {
    bytes path;
    address recipient;
    uint256 deadline;
    uint256 amountOut;
    uint256 maxAmountIn;
  }

  /// @notice Swaps as little as possible of one token for `amountOut` of another along the specified path (reversed)
  /// @param params The parameters necessary for the multi-hop swap, encoded as `ExactOutputParams` in calldata
  /// @return amountIn The amount of the input token
  function swapExactOutput(ExactOutputParams calldata params)
    external
    payable
    returns (uint256 amountIn);
}
