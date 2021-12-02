// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

import '../interfaces/IPool.sol';
import '../libraries/TickMath.sol';
import '../periphery/AntiSnipAttackPositionManager.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';

// import 'hardhat/console.sol';

contract MockSnipAttack {
  function snip1(
    IPool pool,
    AntiSnipAttackPositionManager posManager,
    IBasePositionManager.MintParams calldata params
  ) external {
    IERC20(params.token0).approve(address(posManager), type(uint256).max);
    IERC20(params.token1).approve(address(posManager), type(uint256).max);
    (uint256 tokenId, uint128 liquidity, , ) = posManager.mint(params);
    (IBasePositionManager.Position memory pos, ) = posManager.positions(tokenId);
    uint256 feeGrowthInsideLastBefore = pos.feeGrowthInsideLast;
    // console.log(feeGrowthInsideLastBefore);

    // do swap to increase fees
    pool.swap(
      address(this),
      5e19,
      true,
      TickMath.MIN_SQRT_RATIO + 1,
      abi.encode(msg.sender, params.token0, params.token1)
    );

    // remove all liquidity
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
    // fee growth should be different
    // using require instead of assert because of coverage error
    // console.log(pos.feeGrowthInsideLast);
    require(feeGrowthInsideLastBefore != pos.feeGrowthInsideLast, 'same fee growth');
    // should owe no rTokens
    require(pos.rTokenOwed == 0, 'diff rTokens owed');
  }

  function snip2(
    AntiSnipAttackPositionManager posManager,
    IPool pool,
    IBasePositionManager.MintParams calldata params
  ) external {
    IERC20(params.token0).approve(address(posManager), type(uint256).max);
    IERC20(params.token1).approve(address(posManager), type(uint256).max);
    (uint256 tokenId, uint128 liquidity, , ) = posManager.mint(params);
    (IBasePositionManager.Position memory pos, ) = posManager.positions(tokenId);
    uint256 feeGrowthInsideLastBefore = pos.feeGrowthInsideLast;
    // console.log(feeGrowthInsideLastBefore);

    // do swap to increase fees
    pool.swap(
      address(this),
      5e19,
      true,
      TickMath.MIN_SQRT_RATIO + 1,
      abi.encode(msg.sender, params.token0, params.token1)
    );

    // add small liquidity to lock fees
    (uint128 addedLiquidity, , , ) = posManager.addLiquidity(
      IBasePositionManager.IncreaseLiquidityParams({
        tokenId: tokenId,
        amount0Desired: 1000,
        amount1Desired: 1000,
        amount0Min: 0,
        amount1Min: 0,
        deadline: block.timestamp
      })
    );

    // fee growth should be different
    // using require instead of assert because of coverage error
    (pos, ) = posManager.positions(tokenId);
    // console.log(pos.feeGrowthInsideLast);
    require(feeGrowthInsideLastBefore != pos.feeGrowthInsideLast, 'same fee growth');

    // remove all liquidity
    posManager.removeLiquidity(
      IBasePositionManager.RemoveLiquidityParams({
        tokenId: tokenId,
        liquidity: liquidity + addedLiquidity,
        amount0Min: 0,
        amount1Min: 0,
        deadline: block.timestamp
      })
    );
    (pos, ) = posManager.positions(tokenId);
    // should owe no rTokens
    require(pos.rTokenOwed == 0, 'diff rTokens owed');
    // should have zero fees locked (burnt all)
    (, , , uint256 feesLocked) = posManager.antiSnipAttackData(tokenId);
    require(feesLocked == 0, 'non-zero fees locked');
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
