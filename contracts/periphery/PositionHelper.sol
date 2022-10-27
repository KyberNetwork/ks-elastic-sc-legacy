// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.9;

import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {IERC721} from '@openzeppelin/contracts/token/ERC721/IERC721.sol';

import {IBasePositionManager} from '../interfaces/periphery/IBasePositionManager.sol';

contract PositionHelper {
  using SafeERC20 for IERC20;

  IBasePositionManager public manager;
  address public router;

  constructor(address _manager, address _router) public {
    manager = IBasePositionManager(_manager);
    router = _router;
  }

  /** 
    This function helps users change the tick range of one position.
    1. Transfer position from user to this address.
    2. Remove position
    3. Call swapData
    4. Add liquidity back to the pool
    5. Send leftover funds to owner

    note 
    - slippage check should be in mintParams.
    - recipient of new NFT should be in mintParams.
  */
  function changeTickRange(
    uint256 positionId,
    address token0,
    address token1,
    IBasePositionManager.RemoveLiquidityParams calldata removeLiquidityParams,
    IBasePositionManager.BurnRTokenParams calldata burnRTokenParams,
    IBasePositionManager.MintParams calldata mintParams,
    bytes calldata swapData
  ) external returns (uint256 newPositionId) {
    address sender = msg.sender;

    // 1. Transfer position from sender
    IERC721(address(manager)).transferFrom(sender, address(this), positionId);

    // 2. Remove liquidity
    manager.removeLiquidity(removeLiquidityParams);
    manager.burnRTokens(burnRTokenParams);
    manager.transferAllTokens(token0, 0, address(this));
    manager.transferAllTokens(token1, 0, address(this));
    manager.burn(positionId);

    // 3. Call aggregator router if swapData is not empty
    if (swapData.length != 0 && router != address(0)) {
      approveIfNeeded(router, token0);
      approveIfNeeded(router, token1);
      (bool success, ) = router.call(swapData);
      require(success, "Swap Failed");
    }

    // 4. Add liquidity back
    approveIfNeeded(address(manager), token0);
    approveIfNeeded(address(manager), token1);
    (newPositionId, , ,) = manager.mint(mintParams);

    // 5. Send leftover funds to owner
    IERC20(token0).safeTransfer(sender, IERC20(token0).balanceOf(address(this)));
    IERC20(token1).safeTransfer(sender, IERC20(token1).balanceOf(address(this)));
  }

  // Approve maximum allowance to spender
  function approveIfNeeded(address _spender, address _token) internal {
    uint256 allowance = IERC20(_token).allowance(address(this), _spender);
    if (allowance == 0) {
      uint256 newAllowance = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;
      IERC20(_token).safeIncreaseAllowance(address(_spender), newAllowance);
    }
  }
}