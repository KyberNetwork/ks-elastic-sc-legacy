// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.4;
pragma abicoder v2;

import {AntiSnipAttack} from '../periphery/libraries/AntiSnipAttack.sol';
import {SafeCast} from '../libraries/SafeCast.sol';

import './NonfungiblePositionManager.sol';

contract NonfungiblePositionManagerSnipAttack is NonfungiblePositionManager {
  using SafeCast for uint256;
  mapping(uint256 => AntiSnipAttack.Data) public antiSnipAttackData;

  constructor(
    address _factory,
    address _WETH,
    address _descriptor
  ) NonfungiblePositionManager(_factory, _WETH, _descriptor) {}

  function mint(MintParams calldata params)
    public
    payable
    override
    onlyNotExpired(params.deadline)
    returns (
      uint256 tokenId,
      uint128 liquidity,
      uint256 amount0,
      uint256 amount1
    )
  {
    (tokenId, liquidity, amount0, amount1) = super.mint(params);
    antiSnipAttackData[tokenId] = AntiSnipAttack.initialize(block.timestamp.toUint32());
  }

  function addLiquidity(IncreaseLiquidityParams calldata params)
    external
    payable
    override
    onlyNotExpired(params.deadline)
    returns (
      uint128 liquidity,
      uint256 amount0,
      uint256 amount1,
      uint256 additionalRTokenOwed
    )
  {
    Position storage pos = _positions[params.tokenId];
    PoolInfo memory poolInfo = _poolInfoById[pos.poolId];
    IPool pool;
    uint256 feeGrowthInsideLast;

    int24[2] memory ticksPrevious;
    (liquidity, amount0, amount1, feeGrowthInsideLast, pool) = _addLiquidity(
      AddLiquidityParams({
        token0: poolInfo.token0,
        token1: poolInfo.token1,
        fee: poolInfo.fee,
        recipient: address(this),
        tickLower: pos.tickLower,
        tickUpper: pos.tickUpper,
        ticksPrevious: ticksPrevious,
        amount0Desired: params.amount0Desired,
        amount1Desired: params.amount1Desired,
        amount0Min: params.amount0Min,
        amount1Min: params.amount1Min
      })
    );

    if (feeGrowthInsideLast > pos.feeGrowthInsideLast) {
      // zero fees burnable when adding liquidity
      (additionalRTokenOwed, ) = AntiSnipAttack.update(
        antiSnipAttackData[params.tokenId],
        pos.liquidity,
        liquidity,
        block.timestamp.toUint32(),
        true,
        FullMath.mulDivFloor(
          pos.liquidity,
          feeGrowthInsideLast - pos.feeGrowthInsideLast,
          C.TWO_POW_96
        ),
        IFactory(factory).vestingPeriod()
      );
      pos.rTokenOwed += additionalRTokenOwed;
      pos.feeGrowthInsideLast = feeGrowthInsideLast;
    }

    pos.liquidity += liquidity;
  }

  function removeLiquidity(RemoveLiquidityParams calldata params)
    external
    override
    isAuthorizedForToken(params.tokenId)
    onlyNotExpired(params.deadline)
    returns (
      uint256 amount0,
      uint256 amount1,
      uint256 additionalRTokenOwed
    )
  {
    Position storage pos = _positions[params.tokenId];
    require(pos.liquidity >= params.liquidity, 'Insufficient liquidity');

    PoolInfo memory poolInfo = _poolInfoById[pos.poolId];
    IPool pool = _getPool(poolInfo.token0, poolInfo.token1, poolInfo.fee);

    uint256 feeGrowthInsideLast;
    (amount0, amount1, feeGrowthInsideLast) = pool.burn(
      pos.tickLower,
      pos.tickUpper,
      params.liquidity
    );
    require(amount0 >= params.amount0Min && amount1 >= params.amount1Min, 'Low return amounts');

    if (feeGrowthInsideLast > pos.feeGrowthInsideLast) {
      uint256 feesBurnable;
      (additionalRTokenOwed, feesBurnable) = AntiSnipAttack.update(
        antiSnipAttackData[params.tokenId],
        pos.liquidity,
        params.liquidity,
        block.timestamp.toUint32(),
        false,
        FullMath.mulDivFloor(
          pos.liquidity,
          feeGrowthInsideLast - pos.feeGrowthInsideLast,
          C.TWO_POW_96
        ),
        IFactory(factory).vestingPeriod()
      );
      pos.rTokenOwed += additionalRTokenOwed;
      pos.feeGrowthInsideLast = feeGrowthInsideLast;
      if (feesBurnable > 0) pool.burnRTokens(feesBurnable, true);
    }

    pos.liquidity -= params.liquidity;
  }
}
