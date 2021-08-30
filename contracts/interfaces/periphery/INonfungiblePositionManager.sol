// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.4;

// import {IERC721Metadata} from '@openzeppelin/contracts/token/ERC721/extensions/IERC721Metadata.sol';
// import {IERC721Enumerable} from '@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol';
import {IRouterTokenHelper} from './IRouterTokenHelper.sol';


interface INonfungiblePositionManager is IRouterTokenHelper { //IERC721Enumerable, IERC721Metadata {

  /// @notice Params for the first time adding liquidity, mint new nft to sender
  struct MintParams {
    address token0;
    address token1;
    uint16 fee;
    int24 tickLower;
    int24 tickUpper;
    uint256 amount0Desired;
    uint256 amount1Desired;
    uint256 amount0Min;
    uint256 amount1Min;
    address recipient;
    uint256 deadline;
  }

  /// @notice Params for adding liquidity to the existing position
  struct IncreaseLiquidityParams {
    uint256 tokenId;
    uint256 amount0Desired;
    uint256 amount1Desired;
    uint256 amount0Min;
    uint256 amount1Min;
    uint256 deadline;
  }

  /// @notice Params for remove liquidity from the existing position
  struct RemoveLiquidityParams {
    uint256 tokenId;
    uint128 liquidity;
    uint256 amount0Min;
    uint256 amount1Min;
    uint256 deadline;
  }

  /// @notice Creates a new pool if it does not exist, then unlocks if it has not been unlocked
  /// @param token0 the token0 of the pool
  /// @param token1 the token1 of the pool
  /// @param fee the fee for the pool
  /// @param sqrtPriceX96 the initial price of the pool
  /// @return pool returns the pool address
  function createAndUnlockPoolIfNecessary(
    address token0,
    address token1,
    uint16 fee,
    uint160 sqrtPriceX96
  ) external payable returns (address pool);
}
