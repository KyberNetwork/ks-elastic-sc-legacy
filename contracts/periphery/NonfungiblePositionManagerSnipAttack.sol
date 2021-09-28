// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.4;
pragma abicoder v2;

import './NonfungiblePositionManager.sol';
import {ISnipAttack} from '../interfaces/ISnipAttackData.sol';
import {AntiSnipAttack, SafeCast} from '../periphery/libraries/AntiSnipAttack.sol';
import {IReinvestmentToken} from '../interfaces/IReinvestmentToken.sol';

contract NonfungiblePositionManagerSnipAttack is NonfungiblePositionManager {
  using SafeCast for uint256;
  mapping(uint256 => ISnipAttack.Data) public antiSnipAttackData;

  constructor(
    address _factory,
    address _WETH,
    address _descriptor
  ) NonfungiblePositionManager(_factory, _WETH, _descriptor) {}

  function mint(MintParams calldata params)
    external
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
    IProAMMPool pool;
    uint256 feeGrowthInsideLast;

    (liquidity, amount0, amount1, feeGrowthInsideLast, pool) = addLiquidity(
      AddLiquidityParams({
        token0: params.token0,
        token1: params.token1,
        fee: params.fee,
        recipient: address(this),
        tickLower: params.tickLower,
        tickUpper: params.tickUpper,
        amount0Desired: params.amount0Desired,
        amount1Desired: params.amount1Desired,
        amount0Min: params.amount0Min,
        amount1Min: params.amount1Min
      })
    );

    tokenId = nextTokenId++;
    _mint(params.recipient, tokenId);

    uint80 poolId = _storePoolInfo(address(pool), params.token0, params.token1, params.fee);

    _positions[tokenId] = Position({
      nonce: 0,
      operator: address(0),
      poolId: poolId,
      tickLower: params.tickLower,
      tickUpper: params.tickUpper,
      liquidity: liquidity,
      rTokenOwed: 0,
      feeGrowthInsideLast: feeGrowthInsideLast
    });
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
    IProAMMPool pool;
    uint256 feeGrowthInsideLast;

    (liquidity, amount0, amount1, feeGrowthInsideLast, pool) = addLiquidity(
      AddLiquidityParams({
        token0: poolInfo.token0,
        token1: poolInfo.token1,
        fee: poolInfo.fee,
        recipient: address(this),
        tickLower: pos.tickLower,
        tickUpper: pos.tickUpper,
        amount0Desired: params.amount0Desired,
        amount1Desired: params.amount1Desired,
        amount0Min: params.amount0Min,
        amount1Min: params.amount1Min
      })
    );

    if (feeGrowthInsideLast > pos.feeGrowthInsideLast) {
      uint256 feesBurnable;
      (additionalRTokenOwed, feesBurnable) = AntiSnipAttack.update(
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
        IProAMMFactory(factory).vestingPeriod()
      );
      pos.rTokenOwed += additionalRTokenOwed;
      pos.feeGrowthInsideLast = feeGrowthInsideLast;
      if (feesBurnable > 0) IReinvestmentToken(poolInfo.rToken).burn(feesBurnable);
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
    IProAMMPool pool = _getPool(poolInfo.token0, poolInfo.token1, poolInfo.fee);

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
        IProAMMFactory(factory).vestingPeriod()
      );
      pos.rTokenOwed += additionalRTokenOwed;
      pos.feeGrowthInsideLast = feeGrowthInsideLast;
      if (feesBurnable > 0) IReinvestmentToken(poolInfo.rToken).burn(feesBurnable);
    }

    pos.liquidity -= params.liquidity;
  }
}
