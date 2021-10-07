// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.0;

import {IProAMMPool} from '../../interfaces/IProAMMPool.sol';
import {IProAMMMintCallback} from '../../interfaces/callback/IProAMMMintCallback.sol';
import {IProAMMSwapCallback} from '../../interfaces/callback/IProAMMSwapCallback.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';

contract MockProAMMCallbacks2 is IProAMMMintCallback {
  function mint(
    IProAMMPool pool,
    address recipient,
    int24 tickLower,
    int24 tickUpper,
    int24[2] calldata ticksPrevious,
    uint128 qty
  ) external {
    IERC20 token0 = pool.token0();
    IERC20 token1 = pool.token1();
    pool.mint(
      recipient,
      tickLower,
      tickUpper,
      ticksPrevious,
      qty,
      abi.encode(token0, token1, msg.sender)
    );
  }

  function unlockPool(IProAMMPool pool, uint160 poolSqrtPrice) external {
    IERC20 token0 = pool.token0();
    IERC20 token1 = pool.token1();
    pool.unlockPool(poolSqrtPrice, abi.encode(token0, token1, msg.sender));
  }

  function proAMMMintCallback(
    uint256 deltaQty0,
    uint256 deltaQty1,
    bytes calldata data
  ) external override {
    (IERC20 token0, IERC20 token1, address sender) = abi.decode(data, (IERC20, IERC20, address));
    if (deltaQty0 > 0) token0.transferFrom(sender, msg.sender, deltaQty0);
    if (deltaQty1 > 0) token1.transferFrom(sender, msg.sender, deltaQty1);
  }
}
