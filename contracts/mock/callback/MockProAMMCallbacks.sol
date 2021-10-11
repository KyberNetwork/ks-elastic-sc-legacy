// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

import {IProAMMPoolActions} from '../../interfaces/pool/IProAMMPoolActions.sol';
import {IProAMMMintCallback} from '../../interfaces/callback/IProAMMMintCallback.sol';
import {IProAMMSwapCallback} from '../../interfaces/callback/IProAMMSwapCallback.sol';
import {IProAMMFlashCallback} from '../../interfaces/callback/IProAMMFlashCallback.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';

contract MockProAMMCallbacks is IProAMMMintCallback, IProAMMSwapCallback, IProAMMFlashCallback {
  IERC20 public immutable token0;
  IERC20 public immutable token1;
  address public immutable user;

  constructor(IERC20 tokenA, IERC20 tokenB) {
    (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
    user = msg.sender;
  }

  function unlockPool(
    IProAMMPoolActions pool,
    uint160 poolSqrtPrice,
    bytes calldata data
  ) external {
    pool.unlockPool(poolSqrtPrice, data);
  }

  function mint(
    IProAMMPoolActions pool,
    address recipient,
    int24 tickLower,
    int24 tickUpper,
    int24[2] calldata ticksPrevious,
    uint128 qty,
    bytes calldata data
  ) external {
    pool.mint(recipient, tickLower, tickUpper, ticksPrevious, qty, data);
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

  function flash(
    IProAMMPoolActions pool,
    uint256 qty0,
    uint256 qty1,
    bytes calldata data
  ) external {
    pool.flash(address(this), qty0, qty1, data);
  }

  function badUnlockPool(
    IProAMMPoolActions pool,
    uint160 poolSqrtPrice,
    bool sendLess0,
    bool sendLess1
  ) external {
    pool.unlockPool(poolSqrtPrice, abi.encode(sendLess0, sendLess1));
  }

  function badMint(
    IProAMMPoolActions pool,
    address recipient,
    int24 tickLower,
    int24 tickUpper,
    int24[2] calldata ticksPrevious,
    uint128 qty,
    bool sendLess0,
    bool sendLess1
  ) external {
    pool.mint(
      recipient,
      tickLower,
      tickUpper,
      ticksPrevious,
      qty,
      abi.encode(sendLess0, sendLess1)
    );
  }

  function badSwap(
    IProAMMPoolActions pool,
    address recipient,
    int256 swapQty,
    bool isToken0,
    uint160 sqrtPriceLimit,
    bool sendLess0,
    bool sendLess1
  ) external {
    pool.swap(recipient, swapQty, isToken0, sqrtPriceLimit, abi.encode(sendLess0, sendLess1));
  }

  function badFlash(
    IProAMMPoolActions pool,
    uint256 qty0,
    uint256 qty1,
    bool sendLess0,
    bool sendLess1,
    bool isFee
  ) external {
    pool.flash(address(this), qty0, qty1, abi.encode(sendLess0, sendLess1, isFee));
  }

  function proAMMMintCallback(
    uint256 deltaQty0,
    uint256 deltaQty1,
    bytes calldata data
  ) external override {
    if (data.length > 0) {
      (bool sendLess0, bool sendLess1) = abi.decode(data, (bool, bool));
      if (sendLess0 && deltaQty0 > 0) deltaQty0 -= 1;
      if (sendLess1 && deltaQty1 > 0) deltaQty1 -= 1;
    }
    if (deltaQty0 > 0) token0.transferFrom(user, msg.sender, deltaQty0);
    if (deltaQty1 > 0) token1.transferFrom(user, msg.sender, deltaQty1);
  }

  function proAMMFlashCallback(
    uint256 feeQty0,
    uint256 feeQty1,
    bytes calldata data
  ) external override {
    uint256 tokenQty0 = token0.balanceOf(address(this));
    uint256 tokenQty1 = token1.balanceOf(address(this));
    if (data.length > 0) {
      (bool sendLess0, bool sendLess1, bool isFee) = abi.decode(data, (bool, bool, bool));
      if (isFee) {
        if (sendLess0 && feeQty0 > 0) feeQty0 -= 1;
        if (sendLess1 && feeQty1 > 0) feeQty1 -= 1;
      } else {
        if (sendLess0 && tokenQty0 > 0) tokenQty0 -= 1;
        if (sendLess1 && tokenQty1 > 0) tokenQty1 -= 1;
      }
    }
    if (tokenQty0 > 0) token0.transfer(msg.sender, tokenQty0);
    if (feeQty0 > 0) token0.transferFrom(user, msg.sender, feeQty0);
    if (tokenQty1 > 0) token1.transfer(msg.sender, tokenQty1);
    if (feeQty1 > 0) token1.transferFrom(user, msg.sender, feeQty1);
  }

  function proAMMSwapCallback(
    int256 deltaQty0,
    int256 deltaQty1,
    bytes calldata data
  ) external override {
    if (data.length > 0) {
      (bool sendLess0, bool sendLess1) = abi.decode(data, (bool, bool));
      if (sendLess0 && deltaQty0 > 0) deltaQty0 -= 1;
      if (sendLess1 && deltaQty1 > 0) deltaQty1 -= 1;
    }
    if (deltaQty0 > 0) token0.transferFrom(user, msg.sender, uint256(deltaQty0));
    if (deltaQty1 > 0) token1.transferFrom(user, msg.sender, uint256(deltaQty1));
  }
}
