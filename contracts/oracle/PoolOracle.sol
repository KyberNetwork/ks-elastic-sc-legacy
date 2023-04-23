// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';

import {Initializable} from '@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol';
import {UUPSUpgradeable} from '@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol';
import {OwnableUpgradeable} from '@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol';

import {IPoolOracle} from './../interfaces/oracle/IPoolOracle.sol';
import {IPoolStorage} from './../interfaces/pool/IPoolStorage.sol';
import {Oracle} from './../libraries/Oracle.sol';

/// @title KyberSwap v2 Pool Oracle
contract PoolOracle is
  IPoolOracle,
  Initializable,
  UUPSUpgradeable,
  OwnableUpgradeable
{
  using SafeERC20 for IERC20;
  using Oracle for Oracle.Observation[65535];

  struct ObservationData {
    bool initialized;
    // the most-recently updated index of the observations array
    uint16 index;
    // the current maximum number of observations that are being stored
    uint16 cardinality;
    // the next maximum number of observations to store, triggered in observations.write
    uint16 cardinalityNext;
  }

  mapping(address => Oracle.Observation[65535]) internal poolOrale;
  mapping(address => ObservationData) internal poolObservation;

  function initialize() public initializer {
    __Ownable_init();
  }

  function _authorizeUpgrade(address) internal override onlyOwner {}

  /// @notice Owner's function to rescue any funds stuck in the contract.
  function rescueFund(address token, uint256 amount) external onlyOwner {
    if (token == address(0)) {
      (bool success, ) = payable(owner()).call{value: amount}('');
      require(success, "failed to collect native");
    } else {
      IERC20(token).safeTransfer(owner(), amount);
    }
  }

  /// @inheritdoc IPoolOracle
  function initializeOracle(uint32 time)
    external override
    returns (uint16 cardinality, uint16 cardinalityNext)
  {
    (cardinality, cardinalityNext) = poolOrale[msg.sender].initialize(time);
    poolObservation[msg.sender] = ObservationData({
      initialized: true,
      index: 0,
      cardinality: cardinality,
      cardinalityNext: cardinalityNext
    });
  }

  /// @inheritdoc IPoolOracle
  function write(
    uint32 blockTimestamp,
    int24 tick,
    uint128 liquidity
  )
    external override
    returns (uint16 indexUpdated, uint16 cardinalityUpdated)
  {
    return write(
      poolObservation[msg.sender].index,
      blockTimestamp,
      tick,
      liquidity,
      poolObservation[msg.sender].cardinality,
      poolObservation[msg.sender].cardinalityNext
    );
  }

  /// @inheritdoc IPoolOracle
  function grow(
    uint16 next
  )
    external override
    returns (uint16 cardinalityNextOld, uint16 cardinalityNextNew)
  {
    cardinalityNextOld = poolObservation[msg.sender].cardinalityNext;
    cardinalityNextNew = poolOrale[msg.sender].grow(cardinalityNextOld, next);
    poolObservation[msg.sender].cardinalityNext = cardinalityNextNew;
  }

  /// @inheritdoc IPoolOracle
  function increaseObservationCardinalityNext(
    address pool,
    uint16 observationCardinalityNext
  )
    external
    override
  {
    uint16 observationCardinalityNextOld = poolObservation[pool].cardinalityNext;
    uint16 observationCardinalityNextNew = poolOrale[pool].grow(
      observationCardinalityNextOld,
      observationCardinalityNext
    );
    poolObservation[pool].cardinalityNext = observationCardinalityNextNew;
    if (observationCardinalityNextOld != observationCardinalityNextNew)
      emit IncreaseObservationCardinalityNext(
        pool,
        observationCardinalityNextOld,
        observationCardinalityNextNew
      );
  }

  /// @inheritdoc IPoolOracle
  function write(
    uint16 index,
    uint32 blockTimestamp,
    int24 tick,
    uint128 liquidity,
    uint16 cardinality,
    uint16 cardinalityNext
  )
    public override
    returns (uint16 indexUpdated, uint16 cardinalityUpdated)
  {
    address pool = msg.sender;
    (indexUpdated, cardinalityUpdated) = poolOrale[pool].write(
      index,
      blockTimestamp,
      tick,
      liquidity,
      cardinality,
      cardinalityNext
    );
    poolObservation[pool].index = indexUpdated;
    poolObservation[pool].cardinality = cardinalityUpdated;
  }

  /// @inheritdoc IPoolOracle
  function observeFromPoolAt(
    uint32 time,
    address pool,
    uint32[] memory secondsAgos
  )
    external view override
    returns (
      int56[] memory tickCumulatives,
      uint160[] memory secondsPerLiquidityCumulative
    )
  {
    (, int24 tick, ,) = IPoolStorage(pool).getPoolState();
    (uint128 liquidity, ,) = IPoolStorage(pool).getLiquidityState();
    return poolOrale[pool].observe(
      time,
      secondsAgos,
      tick,
      poolObservation[pool].index,
      liquidity,
      poolObservation[pool].cardinality
    );
  }

  /// @inheritdoc IPoolOracle
  function observeFromPool(
    address pool,
    uint32[] memory secondsAgos
  )
    external view override
    returns (
      int56[] memory tickCumulatives,
      uint160[] memory secondsPerLiquidityCumulative
    )
  {
    (, int24 tick, ,) = IPoolStorage(pool).getPoolState();
    (uint128 liquidity, ,) = IPoolStorage(pool).getLiquidityState();
    return poolOrale[pool].observe(
      uint32(block.timestamp),
      secondsAgos,
      tick,
      poolObservation[pool].index,
      liquidity,
      poolObservation[pool].cardinality
    );
  }

  /// @inheritdoc IPoolOracle
  function observe(
    uint32 time,
    uint32[] memory secondsAgos,
    int24 tick,
    uint128 liquidity
  )
    external view override
    returns (
      int56[] memory tickCumulatives,
      uint160[] memory secondsPerLiquidityCumulative
    )
  {
    return poolOrale[msg.sender].observe(
      time,
      secondsAgos,
      tick,
      poolObservation[msg.sender].index,
      liquidity,
      poolObservation[msg.sender].cardinality
    );
  }

  /// @inheritdoc IPoolOracle
  function observeSingle(
    uint32 time,
    uint32 secondsAgo,
    int24 tick,
    uint128 liquidity
  )
    external view override
    returns (int56 tickCumulative, uint160 secondsPerLiquidityCumulative)
  {
    return poolOrale[msg.sender].observeSingle(
      time,
      secondsAgo,
      tick,
      poolObservation[msg.sender].index,
      liquidity,
      poolObservation[msg.sender].cardinality
    );
  }

  /// @inheritdoc IPoolOracle
  function getPoolObservation(address pool)
    external view override
    returns (bool initialized, uint16 index, uint16 cardinality, uint16 cardinalityNext)
  {
    (initialized, index, cardinality, cardinalityNext) = (
      poolObservation[pool].initialized,
      poolObservation[pool].index,
      poolObservation[pool].cardinality,
      poolObservation[pool].cardinalityNext
    );
  }

  /// @inheritdoc IPoolOracle
  function getObservationAt(address pool, uint256 index)
    external view override
    returns (
      uint32 blockTimestamp,
      int56 tickCumulative,
      uint160 secondsPerLiquidityCumulative,
      bool initialized
    )
  {
    Oracle.Observation memory obsData = poolOrale[pool][index];
    (blockTimestamp, tickCumulative, secondsPerLiquidityCumulative, initialized) = (
      obsData.blockTimestamp,
      obsData.tickCumulative,
      obsData.secondsPerLiquidityCumulativeX128,
      obsData.initialized
    );
  }
}
