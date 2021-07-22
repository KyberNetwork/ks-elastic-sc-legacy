// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.5;

import {IProAMMPoolActions} from '../interfaces/pool/IProAMMPoolActions.sol';
import {IProAMMMintCallback} from '../interfaces/callback/IProAMMMintCallback.sol';
import {IProAMMSwapCallback} from '../interfaces/callback/IProAMMSwapCallback.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';

contract MockProAMMCallbacks is IProAMMMintCallback, IProAMMSwapCallback {
  IERC20 public token0;
  IERC20 public token1;
  address public user;

  constructor(IERC20 tokenA, IERC20 tokenB) {
    (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
    user = msg.sender;
  }

  function changeUser(address _user) external {
    user = _user;
  }

  function unlockPool(
    IProAMMPoolActions pool,
    uint160 poolSqrtPrice,
    address recipient,
    int24 tickLower,
    int24 tickUpper,
    uint128 qty,
    bytes calldata data
  ) external {
    pool.unlockPool(poolSqrtPrice, recipient, tickLower, tickUpper, qty, data);
  }

  function swap(
    IProAMMPoolActions pool,
    address recipient,
    int256 swapQty,
    bool isToken0,
    uint160 sqrtPriceLimit,
    bytes calldata data
  ) external {
    pool.swap(recipient, swapQty, isToken0, sqrtPriceLimit, data);
  }

  function proAMMMintCallback(
    uint256 deltaQty0,
    uint256 deltaQty1,
    bytes calldata // data
  ) external override {
    token0.transferFrom(user, msg.sender, deltaQty0);
    token1.transferFrom(user, msg.sender, deltaQty1);
  }

  function proAMMSwapCallback(
    int256 deltaQty0,
    int256 deltaQty1,
    bytes calldata // data
  ) external override {
    if (deltaQty0 > 0) token0.transferFrom(user, msg.sender, uint256(deltaQty0));
    if (deltaQty1 > 0) token0.transferFrom(user, msg.sender, uint256(deltaQty1));
  }
}
