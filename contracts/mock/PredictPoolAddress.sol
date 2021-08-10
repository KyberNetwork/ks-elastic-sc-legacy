// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.4;

import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {Clones} from '@openzeppelin/contracts/proxy/Clones.sol';

contract PredictPoolAddress {
  using Clones for address;

  function predictPoolAddress(
    address factory,
    address poolMaster,
    IERC20 tokenA,
    IERC20 tokenB,
    uint16 swapFeeBps
  ) external pure returns (address) {
    (IERC20 token0, IERC20 token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
    return
      Clones.predictDeterministicAddress(
        poolMaster,
        keccak256(abi.encode(token0, token1, swapFeeBps)),
        factory
      );
  }
}
