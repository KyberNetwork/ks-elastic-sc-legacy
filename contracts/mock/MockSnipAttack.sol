// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

import '../interfaces/periphery/IBasePositionManager.sol';
import '../interfaces/IPool.sol';
import '../libraries/TickMath.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';

contract MockSnipAttack {
  function snip(
    IBasePositionManager posManager,
    IPool pool,
    IBasePositionManager.MintParams calldata params
  ) external {
    IERC20(params.token0).approve(address(posManager), type(uint256).max);
    IERC20(params.token1).approve(address(posManager), type(uint256).max);
    (uint256 tokenId, uint128 liquidity, , ) = posManager.mint(params);
    (IBasePositionManager.Position memory pos, ) = posManager.positions(tokenId);
    uint256 rTokensOwedBefore = pos.rTokenOwed;
    uint256 feeGrowthInsideLastBefore = pos.feeGrowthInsideLast;

    // do swap to increase fees
    pool.swap(
      address(this),
      5e19,
      true,
      TickMath.MIN_SQRT_RATIO + 1,
      abi.encode(msg.sender, params.token0, params.token1)
    );
    posManager.removeLiquidity(
      IBasePositionManager.RemoveLiquidityParams({
        tokenId: tokenId,
        liquidity: liquidity,
        amount0Min: 0,
        amount1Min: 0,
        deadline: block.timestamp
      })
    );
    (pos, ) = posManager.positions(tokenId);
    // should be different
    // using require instead of assert because of coverage error
    require(feeGrowthInsideLastBefore != pos.feeGrowthInsideLast, 'same fee growth');
    // should remain unchanged
    require(rTokensOwedBefore == pos.rTokenOwed, 'diff rTokens owed');
  }

  function swapCallback(
    int256 deltaQty0,
    int256 deltaQty1,
    bytes calldata data
  ) external {
    (address user, address token0, address token1) = abi.decode(data, (address, address, address));
    if (deltaQty0 > 0) IERC20(token0).transferFrom(user, msg.sender, uint256(deltaQty0));
    if (deltaQty1 > 0) IERC20(token1).transferFrom(user, msg.sender, uint256(deltaQty1));
  }
}
