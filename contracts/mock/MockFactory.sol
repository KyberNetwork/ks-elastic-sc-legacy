// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.8.0;

import {IFactory} from '../interfaces/IFactory.sol';
import {IPoolActions} from '../interfaces/pool/IPoolActions.sol';
import {MathConstants} from '../libraries/MathConstants.sol';
import {BaseSplitCodeFactory} from '../libraries/BaseSplitCodeFactory.sol';
import {Clones} from '@openzeppelin/contracts/proxy/Clones.sol';
import {EnumerableSet} from '@openzeppelin/contracts/utils/structs/EnumerableSet.sol';
import {MockPool} from './MockPool.sol';

/// @title MockFactory
/// @notice Should be the same as Factory, but importing MockPool instead
contract MockFactory is BaseSplitCodeFactory, IFactory {
  using Clones for address;
  using EnumerableSet for EnumerableSet.AddressSet;

  struct Parameters {
    address factory;
    address token0;
    address token1;
    uint16 swapFeeBps;
    int24 tickDistance;
  }

  /// @inheritdoc IFactory
  Parameters public override parameters;

  /// @inheritdoc IFactory
  bytes32 public immutable override poolInitHash;
  address public override configMaster;
  bool public override whitelistDisabled;

  address private feeTo;
  uint16 private governmentFeeBps;
  uint32 public override vestingPeriod;

  /// @inheritdoc IFactory
  mapping(uint16 => int24) public override feeAmountTickDistance;
  /// @inheritdoc IFactory
  mapping(address => mapping(address => mapping(uint16 => address))) public override getPool;

  // list of whitelisted NFT position manager(s)
  // that are allowed to burn liquidity tokens on behalf of users
  EnumerableSet.AddressSet internal whitelistedNFTManagers;

  event NFTManagerAdded(address _nftManager, bool added);
  event NFTManagerRemoved(address _nftManager, bool removed);

  modifier onlyConfigMaster() {
    require(msg.sender == configMaster, 'forbidden');
    _;
  }

  constructor(uint32 _vestingPeriod) BaseSplitCodeFactory(type(MockPool).creationCode) {
    poolInitHash = keccak256(type(MockPool).creationCode);

    vestingPeriod = _vestingPeriod;
    emit VestingPeriodUpdated(_vestingPeriod);

    configMaster = msg.sender;
    emit ConfigMasterUpdated(address(0), configMaster);

    feeAmountTickDistance[5] = 10;
    emit SwapFeeEnabled(5, 10);
    feeAmountTickDistance[30] = 60;
    emit SwapFeeEnabled(30, 60);
  }

  /// @inheritdoc IFactory
  function createPool(
    address tokenA,
    address tokenB,
    uint16 swapFeeBps
  ) external override returns (address pool) {
    require(tokenA != tokenB, 'identical tokens');
    (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
    require(token0 != address(0), 'null address');
    int24 tickDistance = feeAmountTickDistance[swapFeeBps];
    require(tickDistance != 0, 'invalid fee');
    require(getPool[token0][token1][swapFeeBps] == address(0), 'pool exists');

    parameters.factory = address(this);
    parameters.token0 = token0;
    parameters.token1 = token1;
    parameters.swapFeeBps = swapFeeBps;
    parameters.tickDistance = tickDistance;

    pool = _create(bytes(''), keccak256(abi.encode(token0, token1, swapFeeBps)));
    getPool[token0][token1][swapFeeBps] = pool;
    // populate mapping in the reverse direction, deliberate choice to avoid the cost of comparing addresses
    getPool[token1][token0][swapFeeBps] = pool;
    emit PoolCreated(token0, token1, swapFeeBps, tickDistance, pool);
  }

  /// @inheritdoc IFactory
  function updateConfigMaster(address _configMaster) external override onlyConfigMaster {
    emit ConfigMasterUpdated(configMaster, _configMaster);
    configMaster = _configMaster;
  }

  /// @inheritdoc IFactory
  function enableWhitelist() external override onlyConfigMaster {
    whitelistDisabled = false;
    emit WhitelistEnabled();
  }

  /// @inheritdoc IFactory
  function disableWhitelist() external override onlyConfigMaster {
    whitelistDisabled = true;
    emit WhitelistDisabled();
  }

  // Whitelists an NFT manager
  // Returns true if addition was successful, that is if it was not already present
  function addNFTManager(address _nftManager) external onlyConfigMaster returns (bool added) {
    added = whitelistedNFTManagers.add(_nftManager);
    emit NFTManagerAdded(_nftManager, added);
  }

  // Removes a whitelisted NFT manager
  // Returns true if addition was successful, that is if it was not already present
  function removeNFTManager(address _nftManager) external onlyConfigMaster returns (bool removed) {
    removed = whitelistedNFTManagers.remove(_nftManager);
    emit NFTManagerRemoved(_nftManager, removed);
  }

  /// @inheritdoc IFactory
  function updateVestingPeriod(uint32 _vestingPeriod) external override onlyConfigMaster {
    vestingPeriod = _vestingPeriod;
    emit VestingPeriodUpdated(_vestingPeriod);
  }

  /// @inheritdoc IFactory
  function enableSwapFee(uint16 swapFeeBps, int24 tickDistance) public override onlyConfigMaster {
    require(swapFeeBps < MathConstants.BPS, 'invalid fee');
    // tick distance is capped at 16384 to prevent the situation where tickDistance is so large that
    // 16384 ticks represents a >5x price change with ticks of 1 bips
    require(tickDistance > 0 && tickDistance < 16384, 'invalid tickDistance');
    require(feeAmountTickDistance[swapFeeBps] == 0, 'existing tickDistance');
    feeAmountTickDistance[swapFeeBps] = tickDistance;
    emit SwapFeeEnabled(swapFeeBps, tickDistance);
  }

  /// @inheritdoc IFactory
  function updateFeeConfiguration(address _feeTo, uint16 _governmentFeeBps)
    external
    override
    onlyConfigMaster
  {
    require(_governmentFeeBps <= 2000, 'invalid fee');
    require(
      (_feeTo == address(0) && _governmentFeeBps == 0) ||
        (_feeTo != address(0) && _governmentFeeBps != 0),
      'bad config'
    );
    feeTo = _feeTo;
    governmentFeeBps = _governmentFeeBps;
    emit FeeConfigurationUpdated(_feeTo, _governmentFeeBps);
  }

  /// @inheritdoc IFactory
  function feeConfiguration()
    external
    view
    override
    returns (address _feeTo, uint16 _governmentFeeBps)
  {
    _feeTo = feeTo;
    _governmentFeeBps = governmentFeeBps;
  }

  /// @inheritdoc IFactory
  function isWhitelistedNFTManager(address sender) external view override returns (bool) {
    if (whitelistDisabled) return true;
    return whitelistedNFTManagers.contains(sender);
  }

  /// @inheritdoc IFactory
  function getWhitelistedNFTManagers() external view override returns (address[] memory) {
    return whitelistedNFTManagers.values();
  }
}
