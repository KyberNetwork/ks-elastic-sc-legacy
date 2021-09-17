// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.4;
pragma abicoder v2;

import {IProAMMMintCallback} from '../../interfaces/callback/IProAMMMintCallback.sol';
import {RouterTokenHelper} from './RouterTokenHelper.sol';
import {ImmutableRouterStorage} from './ImmutableRouterStorage.sol';
import {IProAMMPool, IProAMMFactory} from '../../interfaces/IProAMMPool.sol';
import {LiquidityMath} from '../../libraries/LiquidityMath.sol';
import {TickMath} from '../../libraries/TickMath.sol';


abstract contract LiquidityHelper is IProAMMMintCallback, ImmutableRouterStorage, RouterTokenHelper {

  struct AddLiquidityParams {
    address token0;
    address token1;
    uint16 fee;
    address recipient;
    int24 tickLower;
    int24 tickUpper;
    uint256 amount0Desired;
    uint256 amount1Desired;
    uint256 amount0Min;
    uint256 amount1Min;
  }

  struct CallbackData {
    address token0;
    address token1;
    uint16 fee;
    address source;
  }

  function proAMMMintCallback(
    uint256 deltaQty0,
    uint256 deltaQty1,
    bytes calldata data
  ) external override {
    CallbackData memory callbackData = abi.decode(data, (CallbackData));
    require(callbackData.token0 < callbackData.token1, 'LiquidityHelper: wrong token order');
    address pool = IProAMMFactory(factory).getPool(callbackData.token0, callbackData.token1, callbackData.fee);
    require(msg.sender == pool, 'LiquidityHelper: invalid callback sender');
    if (deltaQty0 > 0) transferTokens(callbackData.token0, callbackData.source, msg.sender, deltaQty0);
    if (deltaQty1 > 0) transferTokens(callbackData.token1, callbackData.source, msg.sender, deltaQty1);
  }

  /// @dev Unlock pool with initial liquidity
  /// @param token0 the first token of the pool
  /// @param token1 the second token of the pool
  /// @param fee fee of the pool
  /// @param initialSqrtPrice init price for the pool
  /// @return pool address of pool that has been unlocked
  function unlockPool(
    address token0,
    address token1,
    uint16 fee,
    uint160 initialSqrtPrice
  ) internal returns (IProAMMPool pool) {
    pool = IProAMMPool(IProAMMFactory(factory).getPool(token0, token1, fee));
    if (token0 < token1) {
      pool.unlockPool(initialSqrtPrice, _callbackData(token0, token1, fee));
    } else {
      pool.unlockPool(initialSqrtPrice, _callbackData(token1, token0, fee));
    }
  }

  /// @dev Add liquidity to a pool given params
  /// @param params add liquidity params, token0, token1 should be in the correct order
  /// @return liquidity amount of liquidity has been minted
  /// @return amount0 amount of token0 that is needed
  /// @return amount1 amount of token1 that is needed
  /// @return feesClaimable rToken quantity sent to the recipient, representing fees collected by the position
  /// @return pool address of the pool
  function addLiquidity(AddLiquidityParams memory params)
    internal
    returns (
      uint128 liquidity,
      uint256 amount0,
      uint256 amount1,
      uint256 feesClaimable,
      IProAMMPool pool
    ) {
    require(params.token0 < params.token1, 'LiquidityHelper: invalid token order');
    pool = IProAMMPool(IProAMMFactory(factory).getPool(params.token0, params.token1, params.fee));

    // compute the liquidity amount
    {
      (uint160 currentSqrtP, , , ) = pool.getPoolState();
      uint160 lowerSqrtP = TickMath.getSqrtRatioAtTick(params.tickLower);
      uint160 upperSqrtP = TickMath.getSqrtRatioAtTick(params.tickUpper);

      liquidity = LiquidityMath.getLiquidityFromQties(
        currentSqrtP,
        lowerSqrtP,
        upperSqrtP,
        params.amount0Desired,
        params.amount1Desired
      );
    }

    (amount0, amount1, feesClaimable) = pool.mint(
      params.recipient,
      params.tickLower,
      params.tickUpper,
      liquidity,
      _callbackData(params.token0, params.token1, params.fee)
    );

    require(amount0 >= params.amount0Min && amount1 >= params.amount1Min, 'LiquidityHelper: price slippage check');
  }

  function _callbackData(address token0, address token1, uint16 fee) internal view returns (bytes memory) {
    return abi.encode(CallbackData({token0: token0, token1: token1, fee: fee, source: msg.sender}));
  }
}
