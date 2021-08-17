// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

import {Clones} from '@openzeppelin/contracts/proxy/Clones.sol';
import {IProAMMFactory} from '../interfaces/IProAMMFactory.sol';


library PoolHelper {
  using Clones for address;

  /// @notice Compute the address of a clone deployed using {Clones-cloneDeterministic}
  /// @param factory The KyberDMM Factory v2
  /// @param token0 token0 in the pool
  /// @param token1 token1 in the pool
  /// @param fee swap fee in bps of the pool
  /// @return pool The contract address of the v2 pool
  function determineAddress(address factory, address token0, address token1, uint16 fee)
    internal view returns (address pool)
  {
    address poolMaster = IProAMMFactory(factory).poolMaster();
    if (token0 < token1) {
      pool = poolMaster.predictDeterministicAddress(keccak256(abi.encode(token0, token1, fee)));
    } else {
      pool = poolMaster.predictDeterministicAddress(keccak256(abi.encode(token1, token0, fee)));
    }
  }
}
