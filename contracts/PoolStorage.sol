// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.4;

import {Clones} from '@openzeppelin/contracts/proxy/Clones.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';

import {Linkedlist} from './libraries/Linkedlist.sol';
import {TickMath} from './libraries/TickMath.sol';

import {IProAMMFactory} from './interfaces/IProAMMFactory.sol';
import {IPoolStorage} from './interfaces/IPoolStorage.sol';

abstract contract PoolStorage is IPoolStorage {
  using Clones for address;
  using Linkedlist for mapping(int24 => Linkedlist.Data);

  address internal constant LIQUIDITY_LOCKUP_ADDRESS = 0xD444422222222222222222222222222222222222;
  uint128 internal constant MIN_LIQUIDITY = 100000;

  struct PoolData {
    uint256 feeGrowthGlobal;
    uint128 reinvestmentLiquidity;
    uint128 reinvestmentLiquidityLast;
    uint128 liquidity;
    uint128 secondsPerLiquidityGlobal;
    uint32 secondsPerLiquidityUpdateTime;
    uint160 sqrtPrice;
    int24 nearestCurrentTick;
    int24 currentTick;
    bool locked;
  }

  // data stored for each initialized individual tick
  struct TickData {
    // gross liquidity of all positions in tick
    uint128 liquidityGross;
    // liquidity quantity to be added | removed when tick is crossed up | down
    int128 liquidityNet;
    // fee growth per unit of liquidity on the other side of this tick (relative to current tick)
    // only has relative meaning, not absolute — the value depends on when the tick is initialized
    uint256 feeGrowthOutside;
    // seconds spent on the other side of this tick (relative to current tick)
    // only has relative meaning, not absolute — the value depends on when the tick is initialized
    uint128 secondsPerLiquidityOutside;
  }

  // data stored for each user's position
  struct Position {
    // the amount of liquidity owned by this position
    uint128 liquidity;
    // fee growth per unit of liquidity as of the last update to liquidity
    uint256 feeGrowthInsideLast;
  }

  struct CumulativesData {
    uint256 feeGrowth;
    uint128 secondsPerLiquidity;
  }

  /// see IPoolStorage for explanations of the immutables below
  IProAMMFactory public immutable override factory;
  IERC20 public immutable override token0;
  IERC20 public immutable override token1;
  uint128 public immutable override maxTickLiquidity;
  uint16 public immutable override swapFeeBps;
  int24 public immutable override tickDistance;

  mapping(int24 => TickData) public override ticks;
  mapping(int24 => Linkedlist.Data) public override initializedTicks;

  mapping(bytes32 => Position) internal positions;

  PoolData internal poolData;

  constructor() {
    // fetch data from factory constructor
    (
      address _factory,
      address _token0,
      address _token1,
      uint16 _swapFeeBps,
      int24 _tickDistance
    ) = IProAMMFactory(msg.sender).parameters();
    factory = IProAMMFactory(_factory);
    token0 = IERC20(_token0);
    token1 = IERC20(_token1);
    swapFeeBps = _swapFeeBps;
    tickDistance = _tickDistance;

    maxTickLiquidity = type(uint128).max / TickMath.getMaxNumberTicks(_tickDistance);
    poolData.locked = true; // set pool to locked state
  }

  function _initPoolStorage(uint160 initialSqrtPrice, int24 initialTick) internal {
    poolData.reinvestmentLiquidity = MIN_LIQUIDITY;
    poolData.reinvestmentLiquidityLast = MIN_LIQUIDITY;

    poolData.sqrtPrice = initialSqrtPrice;
    poolData.currentTick = initialTick;
    poolData.nearestCurrentTick = TickMath.MIN_TICK;

    initializedTicks.init(TickMath.MIN_TICK, TickMath.MAX_TICK);
  }

  function getPositions(
    address owner,
    int24 tickLower,
    int24 tickUpper
  ) external view override returns (uint128 liquidity, uint256 feeGrowthInsideLast) {
    bytes32 key = positionKey(owner, tickLower, tickUpper);
    return (positions[key].liquidity, positions[key].feeGrowthInsideLast);
  }

  function positionKey(
    address owner,
    int24 tickLower,
    int24 tickUpper
  ) internal pure returns (bytes32) {
    return keccak256(abi.encodePacked(owner, tickLower, tickUpper));
  }

  function secondsPerLiquidityGlobal() external view override returns (uint128) {
    return poolData.secondsPerLiquidityGlobal;
  }

  function secondsPerLiquidityUpdateTime() external view override returns (uint32) {
    return poolData.secondsPerLiquidityUpdateTime;
  }

  // TODO move _poolLiquidity to getReinvestmentState to save 1 slot
  function getPoolState()
    external
    view
    override
    returns (
      uint160 _poolSqrtPrice,
      int24 _poolTick,
      int24 _nearestCurrentTick,
      bool _locked,
      uint128 _poolLiquidity
    )
  {
    _poolSqrtPrice = poolData.sqrtPrice;
    _poolTick = poolData.currentTick;
    _nearestCurrentTick = poolData.nearestCurrentTick;
    _locked = poolData.locked;
    _poolLiquidity = poolData.liquidity;
  }

  function getReinvestmentState()
    external
    view
    override
    returns (
      uint256 _poolFeeGrowthGlobal,
      uint128 _poolReinvestmentLiquidity,
      uint128 _poolReinvestmentLiquidityLast
    )
  {
    return (
      poolData.feeGrowthGlobal,
      poolData.reinvestmentLiquidity,
      poolData.reinvestmentLiquidityLast
    );
  }

  function getSecondsPerLiquidityInside(int24 tickLower, int24 tickUpper)
    external
    view
    override
    returns (uint128 secondsPerLiquidityInside)
  {
    require(tickLower <= tickUpper, 'bad tick range');
    int24 _poolTick = poolData.currentTick;

    uint128 lowerValue = ticks[tickLower].secondsPerLiquidityOutside;
    uint128 upperValue = ticks[tickUpper].secondsPerLiquidityOutside;

    unchecked {
      if (tickLower < _poolTick) {
        secondsPerLiquidityInside = lowerValue - upperValue;
      } else if (_poolTick >= tickUpper) {
        secondsPerLiquidityInside = upperValue - lowerValue;
      } else {
        secondsPerLiquidityInside = poolData.secondsPerLiquidityGlobal - (lowerValue + upperValue);
      }
    }

    // in the case where position is in range (tickLower <= _poolTick < tickUpper),
    // need to add timeElapsed per liquidity
    if (tickLower <= _poolTick && _poolTick < tickUpper) {
      uint256 secondsElapsed = _blockTimestamp() - poolData.secondsPerLiquidityUpdateTime;
      uint128 lp = poolData.liquidity;
      if (secondsElapsed > 0 && lp > 0) {
        unchecked {
          secondsPerLiquidityInside += uint128((secondsElapsed << 96) / lp);
        }
      }
    }
  }

  /// @dev For overriding in tests
  function _blockTimestamp() internal view virtual returns (uint32) {
    return uint32(block.timestamp);
  }
}
