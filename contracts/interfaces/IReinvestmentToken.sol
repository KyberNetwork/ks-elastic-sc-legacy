// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.5.0;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

interface IReinvestmentToken is IERC20 {
  /// @notice called only once upon ProAMMPool deployment
  function initialize() external;

  /// @notice mints specified amount of tokens to recipient
  /// callable by ProAMMPool only
  function mint(address recipient, uint256 amount) external;

  /// @notice burns speicifed amount of tokens from user
  /// callable by ProAMMPool only
  function burn(address user, uint256 amount) external;
}
