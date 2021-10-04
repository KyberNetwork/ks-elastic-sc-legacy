// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';

library TokenHelper {
  using SafeERC20 for IERC20;

  function transferToken(
    IERC20 token,
    uint256 amount,
    address sender,
    address receiver
  ) internal {
    if (sender == address(this)) {
      token.safeTransfer(receiver, amount);
    } else {
      token.safeTransferFrom(sender, receiver, amount);
    }
  }

  function transferEth(address receiver, uint256 amount) internal {
    if (receiver == address(this)) return;
    (bool success, ) = payable(receiver).call{value: amount}('');
    require(success, 'transfer eth failed');
  }
}
