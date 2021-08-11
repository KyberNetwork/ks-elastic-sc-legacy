// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.4;

import {ERC20PermitInitializable} from './ERC20PermitInitializable.sol';
import {IReinvestmentToken} from '../interfaces/IReinvestmentToken.sol';

contract ReinvestmentTokenMaster is ERC20PermitInitializable, IReinvestmentToken {
  address public pool; // immutable, but cannot be set in constructor

  event Mint(address indexed account, uint256 amount);
  event Burn(address indexed account, uint256 amount);

  modifier onlyPool() {
    require(msg.sender == pool, 'only pool');
    _;
  }

  function initialize() public override {
    ERC20PermitInitializable.initialize('Reinvestment Token', 'ProAMM-R', '1');
    pool = msg.sender;
  }

  function mint(address recipient, uint256 amount) external override onlyPool {
    _mint(recipient, amount);
    emit Mint(recipient, amount);
  }

  function burn(address user, uint256 amount) external override onlyPool {
    _burn(user, amount);
    emit Burn(user, amount);
  }
}
