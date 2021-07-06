// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.5;

import {ERC20Permit} from "../libraries/ERC20Permit.sol";
import {IReinvestmentToken} from "../interfaces/IReinvestmentToken.sol";

contract ReinvestmentToken is ERC20Permit, IReinvestmentToken {
    address public immutable pool;

    event Mint(address indexed account, uint256 amount);
    event Burn(address indexed account, uint256 amount);

    modifier onlyPool() {
        require(msg.sender == pool, 'only pool');
        _;
    }

    constructor() ERC20Permit("Reinvestment Token", "ProAMM-R", "1") {
        pool = msg.sender;
    }

    function mint(address recipient, uint256 amount) onlyPool external override {
        _mint(recipient, amount);
        emit Mint(recipient, amount);
    }

    function burn(address user, uint256 amount) onlyPool external override {
        _burn(user, amount);
        emit Burn(user, amount);
    }
}
