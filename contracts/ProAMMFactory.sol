// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.4;

import {IERC20, IProAMMFactory} from './interfaces/IProAMMFactory.sol';
import {IProAMMPoolActions} from './interfaces/pool/IProAMMPoolActions.sol';
import {MathConstants} from './libraries/MathConstants.sol';
import {BaseSplitCodeFactory} from './libraries/BaseSplitCodeFactory.sol';
import {Clones} from '@openzeppelin/contracts/proxy/Clones.sol';
import {EnumerableSet} from '@openzeppelin/contracts/utils/structs/EnumerableSet.sol';
import {ProAMMPool} from './ProAMMPool.sol';

/// @title ProAMM factory
/// @notice Deploys ProAMM pools and manages control over government fees
contract ProAMMFactory is BaseSplitCodeFactory, IProAMMFactory {
  using Clones for address;
  using EnumerableSet for EnumerableSet.AddressSet;

  struct Parameters {
    address factory;
    address token0;
    address token1;
    uint16 swapFeeBps;
    int24 tickSpacing;
  }

  /// @inheritdoc IProAMMFactory
  Parameters public override parameters;

  /// @inheritdoc IProAMMFactory
  address public immutable override reinvestmentTokenMaster;
  address public override configMaster;
  bool public override whitelistDisabled;

  address private feeTo;
  uint16 private governmentFeeBps;
  uint32 public override vestingPeriod;

  /// @inheritdoc IProAMMFactory
  mapping(uint16 => int24) public override feeAmountTickSpacing;
  /// @inheritdoc IProAMMFactory
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

  constructor(address _reinvestmentTokenMaster, uint32 _vestingPeriod)
    BaseSplitCodeFactory(type(ProAMMPool).creationCode)
  {
    reinvestmentTokenMaster = _reinvestmentTokenMaster;

    vestingPeriod = _vestingPeriod;
    emit VestingPeriodUpdated(_vestingPeriod);

    configMaster = msg.sender;
    emit ConfigMasterUpdated(address(0), configMaster);

    feeAmountTickSpacing[5] = 10;
    emit SwapFeeEnabled(5, 10);
    feeAmountTickSpacing[30] = 60;
    emit SwapFeeEnabled(30, 60);
  }

  /// @inheritdoc IProAMMFactory
  function createPool(
    address tokenA,
    address tokenB,
    uint16 swapFeeBps
  ) external override returns (address pool) {
    require(tokenA != tokenB, 'identical tokens');
    (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
    require(token0 != address(0), 'null address');
    int24 tickSpacing = feeAmountTickSpacing[swapFeeBps];
    require(tickSpacing != 0, 'invalid fee');
    require(getPool[token0][token1][swapFeeBps] == address(0), 'pool exists');

    parameters.factory = address(this);
    parameters.token0 = token0;
    parameters.token1 = token1;
    parameters.swapFeeBps = swapFeeBps;
    parameters.tickSpacing = tickSpacing;

    pool = _create(bytes(''), keccak256(abi.encode(token0, token1, swapFeeBps)));
    getPool[token0][token1][swapFeeBps] = pool;
    // populate mapping in the reverse direction, deliberate choice to avoid the cost of comparing addresses
    getPool[token1][token0][swapFeeBps] = pool;
    emit PoolCreated(token0, token1, swapFeeBps, tickSpacing, pool);
  }

  /// @inheritdoc IProAMMFactory
  function updateConfigMaster(address _configMaster) external override onlyConfigMaster {
    emit ConfigMasterUpdated(configMaster, _configMaster);
    configMaster = _configMaster;
  }

  /// @inheritdoc IProAMMFactory
  function enableWhitelist() external override onlyConfigMaster {
    whitelistDisabled = false;
    emit WhitelistEnabled();
  }

  /// @inheritdoc IProAMMFactory
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

  /// @inheritdoc IProAMMFactory
  function updateVestingPeriod(uint32 _vestingPeriod) external override onlyConfigMaster {
    vestingPeriod = _vestingPeriod;
    emit VestingPeriodUpdated(_vestingPeriod);
  }

  /// @inheritdoc IProAMMFactory
  function enableSwapFee(uint16 swapFeeBps, int24 tickSpacing) public override onlyConfigMaster {
    require(swapFeeBps < MathConstants.BPS, 'invalid fee');
    // tick spacing is capped at 16384 to prevent the situation where tickSpacing is so large that
    // TickBitmap#nextInitializedTickWithinOneWord overflows int24 container from a valid tick
    // 16384 ticks represents a >5x price change with ticks of 1 bips
    require(tickSpacing > 0 && tickSpacing < 16384, 'invalid tickSpacing');
    require(feeAmountTickSpacing[swapFeeBps] == 0, 'existing tickSpacing');
    feeAmountTickSpacing[swapFeeBps] = tickSpacing;
    emit SwapFeeEnabled(swapFeeBps, tickSpacing);
  }

  /// @inheritdoc IProAMMFactory
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

  /// @inheritdoc IProAMMFactory
  function feeConfiguration()
    external
    view
    override
    returns (address _feeTo, uint16 _governmentFeeBps)
  {
    _feeTo = feeTo;
    _governmentFeeBps = governmentFeeBps;
  }

  /// @inheritdoc IProAMMFactory
  function isWhitelistedNFTManager(address sender) external view override returns (bool) {
    if (whitelistDisabled) return true;
    return whitelistedNFTManagers.contains(sender);
  }

  /// @inheritdoc IProAMMFactory
  function getWhitelistedNFTManagers()
    external
    view
    override
    returns (address[] memory)
  {
    return whitelistedNFTManagers.values();
  }
}
