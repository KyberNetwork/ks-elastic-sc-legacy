// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.4;

import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {IRouterTokenHelper} from '../../interfaces/periphery/IRouterTokenHelper.sol';
import {IWETH} from '../../interfaces/IWETH.sol';
import {TokenHelper} from '../libraries/TokenHelper.sol';
import {ImmutableRouterStorage} from './ImmutableRouterStorage.sol';


abstract contract RouterTokenHelper is IRouterTokenHelper, ImmutableRouterStorage {
  receive() external payable {
    require(msg.sender == WETH, 'Not WETH');
  }

  function unwrapWETH(uint256 minAmount, address recipient) external payable override {
    uint256 balanceWETH = IWETH(WETH).balanceOf(address(this));
    require(balanceWETH >= minAmount, 'Insufficient WETH');

    if (balanceWETH > 0) {
      IWETH(WETH).withdraw(balanceWETH);
      TokenHelper.transferEth(recipient, balanceWETH);
    }
  }

  function transferAllTokens(
    address token,
    uint256 minAmount,
    address recipient
  ) public payable virtual override {
    uint256 balanceToken = IERC20(token).balanceOf(address(this));
    require(balanceToken >= minAmount, 'Insufficient token');

    if (balanceToken > 0) {
      TokenHelper.transferToken(IERC20(token), balanceToken, address(this), recipient);
    }
  }

  function refundETH() external payable override {
    if (address(this).balance > 0)
      TokenHelper.transferEth(msg.sender, address(this).balance);
  }

  function transferTokens(
    address token,
    address sender,
    address recipient,
    uint256 value
  ) internal {
    if (token == WETH && address(this).balance >= value) {
      IWETH(WETH).deposit{ value: value }();
      IWETH(WETH).transfer(recipient, value);
    } else {
      TokenHelper.transferToken(IERC20(token), value, sender, recipient);
    }
  }
}
