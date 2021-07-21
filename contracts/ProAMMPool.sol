// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.5;

import {IERC20, IProAMMPool} from './interfaces/IProAMMPool.sol';
import {IProAMMFactory} from './interfaces/IProAMMFactory.sol';
import {IReinvestmentToken} from './interfaces/IReinvestmentToken.sol';
import {IProAMMMintCallback} from './interfaces/callback/IProAMMMintCallback.sol';
import {IProAMMSwapCallback} from './interfaces/callback/IProAMMSwapCallback.sol';
import {IProAMMFlashCallback} from './interfaces/callback/IProAMMFlashCallback.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {Clones} from '@openzeppelin/contracts/proxy/Clones.sol';
import {LiqDeltaMath} from './libraries/LiqDeltaMath.sol';
import {MathConstants, QtyDeltaMath} from './libraries/QtyDeltaMath.sol';
import {ReinvestmentMath} from './libraries/ReinvestmentMath.sol';
import {SwapMath} from './libraries/SwapMath.sol';
import {SafeCast} from './libraries/SafeCast.sol';
import {Tick, TickMath} from './libraries/Tick.sol';
import {TickBitmap} from './libraries/TickBitmap.sol';
import {Position} from './libraries/Position.sol';

contract ProAMMPool is IProAMMPool {
  using Clones for address;
  using SafeCast for uint256;
  using SafeCast for int256;
  using SafeERC20 for IERC20;
  using SafeERC20 for IReinvestmentToken;
  using Tick for mapping(int24 => Tick.Data);
  using TickBitmap for mapping(int16 => uint256);
  using Position for mapping(bytes32 => Position.Data);
  using Position for Position.Data;

  /// see IProAMMPool for explanations of the immutables below
  /// can't be set in constructor to be EIP-1167 compatible
  /// hence lacking immutable keyword
  IProAMMFactory public override factory;
  IERC20 public override token0;
  IERC20 public override token1;
  uint128 public override maxLiquidityPerTick;
  uint16 public override swapFeeBps;
  int24 public override tickSpacing;

  // maximum ticks traversable, so that we can use a simpler formula
  // for calculation of collectible fees
  int24 private constant MAX_TICK_DISTANCE = 487; // ~5% price movement
  int24 private constant MIN_LIQUIDITY = 1000;
  uint8 private constant LOCKED = 1;
  uint8 private constant UNLOCKED = 2;
  uint8 private lockStatus = LOCKED;
  // the current government fee as a percentage of the swap fee taken on withdrawal
  // value is fetched from factory and updated whenever a position is modified
  // or when government fee is collected
  uint16 private governmentFeeBps;

  // see IProAMMPool#getPoolState for explanations of the variables below
  uint160 internal poolSqrtPrice;
  int24 internal poolTick;
  uint128 internal poolLiquidity;
  // see IProAMMPool#getReinvestmentAndFees for explanations of the variables below
  uint256 internal poolFeeGrowthGlobal;
  uint256 internal poolReinvestmentLiquidity;
  uint256 internal poolReinvestmentLiquidityLast;
  // see IProAMMPool for explanations of the variables below
  IReinvestmentToken public override reinvestmentToken;
  uint256 public override collectedGovernmentFee;
  mapping(int24 => Tick.Data) public override ticks;
  mapping(int16 => uint256) public override tickBitmap;
  mapping(bytes32 => Position.Data) public override positions;

  /// @dev Mutually exclusive reentrancy protection into the pool from/to a method.
  /// Also prevents entrance to pool actions prior to initalization
  modifier lock() {
    require(lockStatus == UNLOCKED, 'locked');
    lockStatus = LOCKED;
    _;
    lockStatus = UNLOCKED;
  }

  function initialize(
    address _factory,
    IERC20 _token0,
    IERC20 _token1,
    uint16 _swapFeeBps,
    int24 _tickSpacing
  ) external override {
    require(address(factory) == address(0), 'already inited');
    (factory, token0, token1, swapFeeBps, tickSpacing) = (
      IProAMMFactory(_factory),
      _token0,
      _token1,
      _swapFeeBps,
      _tickSpacing
    );
    maxLiquidityPerTick = Tick.calcMaxLiquidityPerTickFromSpacing(_tickSpacing);
  }

  /// @dev Get pool's balance of token0
  /// Gas saving to avoid a redundant extcodesize check
  /// in addition to the returndatasize check
  function poolBalToken0() private view returns (uint256) {
    (bool success, bytes memory data) = address(token0).staticcall(
      abi.encodeWithSelector(IERC20.balanceOf.selector, address(this))
    );
    require(success && data.length >= 32);
    return abi.decode(data, (uint256));
  }

  /// @dev Get pool's balance of token1
  /// Gas saving to avoid a redundant extcodesize check
  /// in addition to the returndatasize check
  function poolBalToken1() private view returns (uint256) {
    (bool success, bytes memory data) = address(token1).staticcall(
      abi.encodeWithSelector(IERC20.balanceOf.selector, address(this))
    );
    require(success && data.length >= 32);
    return abi.decode(data, (uint256));
  }

  function getPoolState()
    external
    override
    view
    returns (
      uint160,
      int24,
      uint128
    )
  {
    return (poolSqrtPrice, poolTick, poolLiquidity);
  }

  function getReinvestmentState()
    external
    override
    view
    returns (
      uint256,
      uint256,
      uint256
    )
  {
    return (poolFeeGrowthGlobal, poolReinvestmentLiquidity, poolReinvestmentLiquidityLast);
  }

  /// see IProAMMPoolActions
  function unlockPool(
    uint160 initialSqrtPrice,
    address recipient,
    int24 tickLower,
    int24 tickUpper,
    uint128 qty,
    bytes calldata data
  ) external override {
    require(address(reinvestmentToken) == address(0), 'already inited');
    lockStatus = UNLOCKED; // unlock the pool
    int24 _initialTick = TickMath.getTickAtSqrtRatio(initialSqrtPrice);
    // initial tick must be within lower and upper ticks, exclusive
    require(tickLower < _initialTick && _initialTick < tickUpper, 'price ! in range');
    poolTick = _initialTick;
    poolSqrtPrice = initialSqrtPrice;
    reinvestmentToken = IReinvestmentToken(factory.reinvestmentTokenMaster().clone());
    reinvestmentToken.initialize();
    mint(recipient, tickLower, tickUpper, qty, data);
    emit Initialize(initialSqrtPrice, poolTick);
  }

  struct TweakPositionData {
    // address of owner of the position
    address owner;
    // position's lower and upper ticks
    int24 tickLower;
    int24 tickUpper;
    // any change in liquidity
    int128 liquidityDelta;
  }

  /// @dev Make changes to a position
  /// @param posData the position details and the change to the position's liquidity to effect
  /// @return qty0 token0 qty owed to the pool, negative if the pool should pay the recipient
  /// @return qty1 token1 qty owed to the pool, negative if the pool should pay the recipient
  function _tweakPosition(TweakPositionData memory posData)
    private
    returns (int256 qty0, int256 qty1)
  {
    require(posData.tickLower < posData.tickUpper, 'invalid ticks');
    require(posData.tickLower >= TickMath.MIN_TICK, 'invalid lower tick');
    require(posData.tickUpper <= TickMath.MAX_TICK, 'invalid upper tick');

    // SLOADs for gas optimization
    int24 _poolTick = poolTick;
    uint128 lp = poolLiquidity;
    uint256 lf = poolReinvestmentLiquidity;
    // for first LP provider (posData.liquidityDelta > 0),
    // permanently lockup MIN_LIQUIDITY as pool reinvestment liquidity (lf)
    if (lf == 0) {
      posData.liquidityDelta -= MIN_LIQUIDITY;
      lf = uint24(MIN_LIQUIDITY);
      poolReinvestmentLiquidity = lf;
      // poolReinvestmentLiquidityLast will be updated in _updatePosition
    }

    _updatePosition(
      posData.owner,
      posData.tickLower,
      posData.tickUpper,
      posData.liquidityDelta,
      _poolTick,
      lp,
      lf
    );

    if (_poolTick < posData.tickLower) {
      // current tick < position range
      // liquidity only comes in range when tick increases
      // which occurs when pool increases in token1, decreases in token0
      // means token0 is appreciating more against token1
      // hence user should provide token0
      qty0 = QtyDeltaMath.getQty0Delta(
        TickMath.getSqrtRatioAtTick(posData.tickLower),
        TickMath.getSqrtRatioAtTick(posData.tickUpper),
        posData.liquidityDelta
      );
    } else if (_poolTick < posData.tickUpper) {
      // current tick is inside the passed range
      uint160 _poolSqrtPrice = poolSqrtPrice; // SLOAD for gas optimization

      qty0 = QtyDeltaMath.getQty0Delta(
        _poolSqrtPrice,
        TickMath.getSqrtRatioAtTick(posData.tickUpper),
        posData.liquidityDelta
      );
      qty1 = QtyDeltaMath.getQty1Delta(
        TickMath.getSqrtRatioAtTick(posData.tickLower),
        _poolSqrtPrice,
        posData.liquidityDelta
      );

      // in addition, add liquidityDelta to current poolLiquidity
      // since liquidity is in range
      poolLiquidity = LiqDeltaMath.addLiquidityDelta(lp, posData.liquidityDelta);
    } else {
      // current tick > position range
      // liquidity only comes in range when tick decreases
      // which occurs when pool decreases in token1, increases in token0
      // means token1 is appreciating more against token0
      // hence user should provide token1
      qty1 = QtyDeltaMath.getQty1Delta(
        TickMath.getSqrtRatioAtTick(posData.tickLower),
        TickMath.getSqrtRatioAtTick(posData.tickUpper),
        posData.liquidityDelta
      );
    }
  }

  /// @dev Gets and updates a position with the given liquidity delta
  /// @param owner address of owner of the position
  /// @param tickLower position's lower tick
  /// @param tickUpper position's upper tick
  /// @param liquidityDelta change in position's liquidity
  /// @param currentTick  current pool tick, passed to avoid sload
  /// @param lp current pool liquidity, passed to avoid sload
  /// @param lf current pool reinvestment liquidity, passed to avoid sload
  function _updatePosition(
    address owner,
    int24 tickLower,
    int24 tickUpper,
    int128 liquidityDelta,
    int24 currentTick,
    uint128 lp,
    uint256 lf
  ) private {
    Position.Data storage position = positions.get(owner, tickLower, tickUpper);

    // SLOADs for gas optimization
    uint256 _feeGrowthGlobal = poolFeeGrowthGlobal;
    uint256 lfLast = poolReinvestmentLiquidityLast;

    // update ticks if necessary
    bool flippedLower = ticks.update(
      tickLower,
      currentTick,
      liquidityDelta,
      _feeGrowthGlobal,
      true,
      maxLiquidityPerTick
    );
    if (flippedLower) {
      tickBitmap.flipTick(tickLower, tickSpacing);
    }
    bool flippedUpper = ticks.update(
      tickUpper,
      currentTick,
      liquidityDelta,
      _feeGrowthGlobal,
      false,
      maxLiquidityPerTick
    );
    if (flippedUpper) {
      tickBitmap.flipTick(tickUpper, tickSpacing);
    }

    // mint reinvestment tokens if necessary
    if (liquidityDelta > 0 && (lf != lfLast)) {
      // calculate rMintQty
      uint256 rMintQty = (lfLast == 0)
        ? uint24(MIN_LIQUIDITY)
        : ReinvestmentMath.calcrMintQtyInLiquidityDelta(
          lf,
          poolReinvestmentLiquidityLast,
          lp,
          reinvestmentToken.totalSupply()
        );
      // mint to pool
      reinvestmentToken.mint(address(this), rMintQty);
      // update fee global
      _feeGrowthGlobal += ReinvestmentMath.calcFeeGrowthIncrement(
        rMintQty,
        (_feeGrowthGlobal == 0) ? uint128(liquidityDelta) : lp);
      poolFeeGrowthGlobal = _feeGrowthGlobal;
      // update poolReinvestmentLiquidityLast
      poolReinvestmentLiquidityLast = lf;
    }

    // fees = feeGrowthInside
    uint256 fees = ticks.getFeeGrowthInside(tickLower, tickUpper, currentTick, _feeGrowthGlobal);
    // fees variable = rTokens to be minted for the position's accumulated fees
    fees = position.update(liquidityDelta, fees);
    if (fees > 0) {
      // transfer rTokens from pool to owner
      reinvestmentToken.safeTransfer(owner, fees);
    }
    // clear any tick data that is no longer needed
    if (liquidityDelta < 0) {
      if (flippedLower) {
        ticks.clear(tickLower);
      }
      if (flippedUpper) {
        ticks.clear(tickUpper);
      }
    }
  }

  /// see IProAMMPoolActions
  function mint(
    address recipient,
    int24 tickLower,
    int24 tickUpper,
    uint128 qty,
    bytes calldata data
  ) public override lock returns (uint256 qty0, uint256 qty1) {
    require(qty > 0, 'zero qty');
    (int256 qty0Int, int256 qty1Int) = _tweakPosition(
      TweakPositionData({
        owner: recipient,
        tickLower: tickLower,
        tickUpper: tickUpper,
        liquidityDelta: int256(uint256(qty)).toInt128()
      })
    );

    qty0 = uint256(qty0Int);
    qty1 = uint256(qty1Int);

    uint256 balance0Before;
    uint256 balance1Before;
    if (qty0 > 0) balance0Before = poolBalToken0();
    if (qty1 > 0) balance1Before = poolBalToken1();
    IProAMMMintCallback(msg.sender).proAMMMintCallback(qty0, qty1, data);
    if (qty0 > 0) require(balance0Before + qty0 <= poolBalToken0(), 'lacking qty0');
    if (qty1 > 0) require(balance1Before + qty1 <= poolBalToken1(), 'lacking qty1');

    emit Mint(msg.sender, recipient, tickLower, tickUpper, qty, qty0, qty1);
  }

  /// see IProAMMPoolActions
  function burn(
    int24 tickLower,
    int24 tickUpper,
    uint128 qty
  ) external override lock returns (uint256 qty0, uint256 qty1) {
    require(qty > 0, 'zero qty');
    (int256 qty0Int, int256 qty1Int) = _tweakPosition(
      TweakPositionData({
        owner: msg.sender,
        tickLower: tickLower,
        tickUpper: tickUpper,
        liquidityDelta: int256(type(uint256).max - uint256(qty) + 1).toInt128()
      })
    );

    qty0 = type(uint256).max - uint256(qty0Int) + 1;
    qty1 = type(uint256).max - uint256(qty1Int) + 1;
    if (qty0 > 0) token0.safeTransfer(msg.sender, qty0);
    if (qty1 > 0) token1.safeTransfer(msg.sender, qty1);
    emit BurnLP(msg.sender, tickLower, tickUpper, qty, qty0, qty1);
  }

  function burnRTokens(uint256 _qty) external override lock returns (uint256 qty0, uint256 qty1) {
    // SLOADs for gas optimizations
    uint256 lf = poolReinvestmentLiquidity;
    uint128 lp = poolLiquidity;
    uint160 pc = poolSqrtPrice;
    uint256 rTotalSupply = reinvestmentToken.totalSupply();
    // calculate rMintQty
    uint256 rMintQty = ReinvestmentMath.calcrMintQtyInLiquidityDelta(
      lf,
      poolReinvestmentLiquidityLast,
      lp,
      rTotalSupply
    );
    // mint tokens to pool
    reinvestmentToken.mint(address(this), rMintQty);
    rTotalSupply += rMintQty;
    // burn _qty of caller
    // router should transfer _qty from user to itself, but not send it to the pool
    // for direct calls, msg.sender should have sufficient balance
    reinvestmentToken.burn(msg.sender, _qty);
    // rTotalSupply is the reinvestment token supply after minting, but before burning
    uint256 lfDelta = ReinvestmentMath.calcLfDelta(_qty, lf, rTotalSupply);
    poolFeeGrowthGlobal =
      poolFeeGrowthGlobal +
      ReinvestmentMath.calcFeeGrowthIncrement(rMintQty, poolLiquidity);
    poolReinvestmentLiquidity = lf - lfDelta;
    poolReinvestmentLiquidityLast = poolReinvestmentLiquidity;
    // finally, calculate and send token quantities to user
    uint256 tokenQty = QtyDeltaMath.getQty0FromBurnRTokens(pc, lfDelta);
    if (tokenQty > 0) token0.safeTransfer(msg.sender, tokenQty);
    tokenQty = QtyDeltaMath.getQty1FromBurnRTokens(pc, lfDelta);
    if (tokenQty > 0) token1.safeTransfer(msg.sender, tokenQty);
    emit BurnRTokens(msg.sender, _qty, qty0, qty1);
  }

  // temporary swap variables, some of which will be used to update the pool state
  struct SwapData {
    // the quantity remaining to be swapped in/out of the input/output asset
    int256 deltaRemaining;
    // the quantity needed to cross to the next tick
    int256 deltaNext;
    // the quantity already swapped out/in of the output/input asset
    int256 actualDelta;
    // current sqrt(price), multiplied by 2^96
    uint160 sqrtPc;
    // next sqrt(price), multiplied by 2^96
    uint160 sqrtPn;
    // the tick associated with the current price
    int24 currentTick;
    // the tick associated with the next price
    int24 nextTick;
    // whether nextTick is initialized
    bool initialized;
    // the global fee growth of the input token, multiplied by 2^96
    uint256 feeGrowthGlobal;
    // LP token qty paid as government fee
    uint256 governmentFee;
    // the current pool liquidity
    uint128 lp;
    // the current reinvestment liquidity
    uint256 lf;
    // collected liquidity
    uint256 lc;
    // total reinvestment token supply, possibly incremented
    uint256 rTotalSupply;
    // initial total reinvestment token supply, to cache the value
    uint256 rTotalSupplyInitial;
  }

  // see IProAMMPoolActions
  // for specified exact output, swaps will execute up to sqrtPriceLimit,
  // even if target swapQty is not reached
  function swap(
    address recipient,
    int256 swapQty,
    bool isToken0,
    uint160 sqrtPriceLimit,
    bytes calldata data
  ) external override lock returns (int256 deltaQty0, int256 deltaQty1) {
    require(swapQty != 0, '0 swapQty');
    bool isExactInput = swapQty > 0;
    // tick (token1Amt/token0Amt) will increase for token0Output or token1Input
    bool willUpTick = (!isExactInput && isToken0) || (isExactInput && !isToken0);
    require(
      willUpTick
        ? (sqrtPriceLimit > poolSqrtPrice && sqrtPriceLimit < TickMath.MAX_SQRT_RATIO)
        : (sqrtPriceLimit < poolSqrtPrice && sqrtPriceLimit > TickMath.MIN_SQRT_RATIO),
      'bad sqrtPriceLimit'
    );

    SwapData memory swapData = SwapData({
      deltaRemaining: swapQty,
      deltaNext: 0,
      actualDelta: 0,
      sqrtPc: poolSqrtPrice,
      sqrtPn: 0,
      currentTick: poolTick,
      nextTick: 0,
      initialized: false,
      feeGrowthGlobal: 0,
      governmentFee: 0,
      lp: poolLiquidity,
      lf: poolReinvestmentLiquidity,
      lc: 0,
      rTotalSupply: 0,
      rTotalSupplyInitial: 0
    });

    // continue swapping while specified input/output isn't satisfied or price limit not reached
    while (swapData.deltaRemaining != 0 && swapData.sqrtPc != sqrtPriceLimit) {
      (swapData.nextTick, swapData.initialized) = tickBitmap.nextInitializedTickWithinOneWord(
        swapData.currentTick,
        tickSpacing,
        willUpTick
      );

      // ensure that next tick does not exceed min / max tick
      if (swapData.nextTick < TickMath.MIN_TICK) {
        swapData.nextTick = TickMath.MIN_TICK;
      } else if (swapData.nextTick > TickMath.MAX_TICK) {
        swapData.nextTick = TickMath.MAX_TICK;
      }

      while (swapData.currentTick != swapData.nextTick && swapData.deltaRemaining != 0) {
        // increment currentTick by max distance, capped at nextTick
        if (willUpTick) {
          swapData.currentTick = swapData.currentTick + MAX_TICK_DISTANCE;
          if (swapData.currentTick > swapData.nextTick) swapData.currentTick = swapData.nextTick;
        } else {
          swapData.currentTick = swapData.currentTick - MAX_TICK_DISTANCE;
          if (swapData.currentTick < swapData.nextTick) swapData.currentTick = swapData.nextTick;
        }

        // get next sqrt price for the new tick
        swapData.sqrtPn = TickMath.getSqrtRatioAtTick(swapData.currentTick);
        // calculate deltaNext
        swapData.deltaNext = SwapMath.calcDeltaNext(
          swapData.lp + swapData.lf,
          swapData.sqrtPc,
          swapData.sqrtPn,
          swapFeeBps,
          isExactInput,
          isToken0
        );
        // TODO: R&D into finding another solution
        // which consumes less gas, or be able to relax the equality
        // if (
        //   isExactInput
        //     ? (swapData.deltaNext >= swapData.deltaRemaining)
        //     : (swapData.deltaNext <= swapData.deltaRemaining)
        // )
        if (
          isExactInput
            ? (
              (isToken0)
                ? (swapData.deltaNext >= swapData.deltaRemaining)
                : (swapData.deltaNext > swapData.deltaRemaining)
            )
            : (
              (isToken0)
                ? (swapData.deltaNext <= swapData.deltaRemaining)
                : (swapData.deltaNext < swapData.deltaRemaining)
            )
        ) {
          (swapData.actualDelta, swapData.lc, swapData.governmentFee, swapData.sqrtPn) = SwapMath
            .calcSwapInTick(
            SwapMath.SwapParams({
              delta: swapData.deltaRemaining,
              lpPluslf: swapData.lp + swapData.lf,
              lc: swapData.lc,
              governmentFee: swapData.governmentFee,
              sqrtPc: swapData.sqrtPc,
              sqrtPn: swapData.sqrtPn,
              swapFeeBps: swapFeeBps,
              governmentFeeBps: governmentFeeBps,
              isExactInput: isExactInput,
              isToken0: isToken0,
              calcFinalPrice: true
            })
          );

          // set deltaRemaining to 0 to exit loop
          swapData.deltaRemaining = 0;

          // update pool variables
          poolSqrtPrice = swapData.sqrtPn;
          poolReinvestmentLiquidity = swapData.lf + swapData.lc;
          poolTick = TickMath.getTickAtSqrtRatio(swapData.sqrtPn);
          collectedGovernmentFee += swapData.governmentFee;

          // if rTotalSupply has been initialized (tick crossed), update feeGlobal, lp and lf
          // also mint reinvestment tokens
          if (swapData.rTotalSupply != 0) {
            // update rTotalSupply, feeGrowthGlobal and lf
            (swapData.rTotalSupply, swapData.feeGrowthGlobal, swapData.lf) = ReinvestmentMath
              .updateReinvestments(
              swapData.lp,
              swapData.lf,
              swapData.lc,
              swapData.rTotalSupply,
              swapData.feeGrowthGlobal
            );
            reinvestmentToken.mint(
              address(this),
              swapData.rTotalSupply - swapData.rTotalSupplyInitial
            );
            // update pool variables
            poolFeeGrowthGlobal = swapData.feeGrowthGlobal;
            poolLiquidity = swapData.lp;
            poolReinvestmentLiquidityLast = swapData.lf;
          }
        } else {
          // notice that swapData.sqrtPn isn't updated
          // and is kept as the sqrtPrice of the updated current tick
          (swapData.actualDelta, swapData.lc, swapData.governmentFee, ) = SwapMath.calcSwapInTick(
            SwapMath.SwapParams({
              delta: swapData.deltaNext,
              lpPluslf: swapData.lp + swapData.lf,
              lc: swapData.lc,
              governmentFee: swapData.governmentFee,
              sqrtPc: swapData.sqrtPc,
              sqrtPn: swapData.sqrtPn,
              swapFeeBps: swapFeeBps,
              governmentFeeBps: governmentFeeBps,
              isExactInput: isExactInput,
              isToken0: isToken0,
              calcFinalPrice: false
            })
          );

          // reduce deltaRemaining by deltaNext
          swapData.deltaRemaining -= swapData.deltaNext;
          // update currentSqrtPrice
          swapData.sqrtPc = swapData.sqrtPn;
          // init rTotalSupply, rTotalSupplyInitial and feeGrowthGlobal if uninitialized
          if (swapData.rTotalSupply == 0) {
            swapData.feeGrowthGlobal = poolFeeGrowthGlobal;
            swapData.rTotalSupplyInitial = reinvestmentToken.totalSupply();
            swapData.rTotalSupply = swapData.rTotalSupplyInitial;
          }
          // update rTotalSupply, feeGrowthGlobal and lf
          (swapData.rTotalSupply, swapData.feeGrowthGlobal, swapData.lf) = ReinvestmentMath
            .updateReinvestments(
            swapData.lp,
            swapData.lf,
            swapData.lc,
            swapData.rTotalSupply,
            swapData.feeGrowthGlobal
          );
        }
      }
      // cross ticks if current tick == nextTick
      if (swapData.currentTick == swapData.nextTick) {
        if (swapData.initialized) {
          int128 liquidityNet = ticks.crossToTick(swapData.nextTick, swapData.feeGrowthGlobal);
          swapData.lp = LiqDeltaMath.addLiquidityDelta(swapData.lp, liquidityNet);
        }
        // if tick moves down, need to decrease by 1
        if (!willUpTick) swapData.currentTick = swapData.nextTick - 1;
      }
    }

    (deltaQty0, deltaQty1) = isToken0
      ? (swapQty - swapData.deltaRemaining, swapData.actualDelta)
      : (swapData.actualDelta, swapQty - swapData.deltaRemaining);

    // handle token transfers, make and callback
    if (willUpTick) {
      // outbound deltaQty0 (negative), inbound deltaQty1 (positive)
      // transfer deltaQty0 to recipient
      if (deltaQty0 < 0)
        token0.safeTransfer(recipient, type(uint256).max - uint256(deltaQty0) + 1);

      // collect deltaQty1
      uint256 balance1Before = poolBalToken1();
      IProAMMSwapCallback(msg.sender).proAMMSwapCallback(deltaQty0, deltaQty1, data);
      require(poolBalToken1() >= balance1Before + uint256(deltaQty1), 'lacking deltaQty1');
    } else {
      // inbound deltaQty0 (positive), outbound deltaQty1 (negative)
      // transfer deltaQty1 to recipient
      if (deltaQty1 < 0)
        token1.safeTransfer(recipient, type(uint256).max - uint256(deltaQty1) + 1);

      // collect deltaQty0
      uint256 balance0Before = poolBalToken0();
      IProAMMSwapCallback(msg.sender).proAMMSwapCallback(deltaQty0, deltaQty1, data);
      require(poolBalToken0() >= balance0Before + uint256(deltaQty0), 'lacking deltaQty0');
    }

    emit Swap(msg.sender, recipient, deltaQty0, deltaQty1, poolSqrtPrice, poolLiquidity, poolTick);
  }

  /// see IProAMMPoolActions
  // function flash(
  //     address recipient,
  //     uint256 qty0,
  //     uint256 qty1,
  //     bytes calldata data
  // ) external override lock {
  //     uint128 _liquidity = poolLiquidity;
  //     require(_liquidity > 0, 'L');

  //     uint256 flashFee0 = qty0 * swapFeeBps / MathConstants.BPS;
  //     uint256 flashFee1 = qty1 * swapFeeBps / MathConstants.BPS;
  //     uint256 balance0Before = poolBalToken0();
  //     uint256 balance1Before = poolBalToken1();

  //     if (qty0 > 0) token0.safeTransfer(recipient, qty0);
  //     if (qty1 > 0) token1.safeTransfer(recipient, qty1);

  //     IProAMMFlashCallback(msg.sender).proAMMFlashCallback(flashFee0, flashFee1, data);

  //     uint256 balance0After = poolBalToken0();
  //     uint256 balance1After = poolBalToken1();

  //     require(balance0Before + flashFee0 <= balance0After, 'F0');
  //     require(balance1Before + flashFee1 <= balance1After, 'F1');

  //     uint256 paid0 = balance0After - balance0Before;
  //     uint256 paid1 = balance1After - balance1Before;

  //     // TODO: convert pool token fee to LP token fee (and account for govt fee)
  //     if (paid0 > 0) {

  //         uint8 feeProtocol0 = slot0.feeProtocol % 16;
  //         uint256 fees0 = feeProtocol0 == 0 ? 0 : paid0 / feeProtocol0;
  //         if (uint128(fees0) > 0) protocolFees.token0 += uint128(fees0);
  //         feeGrowthGlobal0X128 += FullMath.mulDiv(paid0 - fees0, FixedPoint128.Q128, _liquidity);
  //     }
  //     if (paid1 > 0) {
  //         uint8 feeProtocol1 = slot0.feeProtocol >> 4;
  //         uint256 fees1 = feeProtocol1 == 0 ? 0 : paid1 / feeProtocol1;
  //         if (uint128(fees1) > 0) protocolFees.token1 += uint128(fees1);
  //         feeGrowthGlobal1X128 += FullMath.mulDiv(paid1 - fees1, FixedPoint128.Q128, _liquidity);
  //     }

  //     emit Flash(msg.sender, recipient, qty0, qty1, paid0, paid1);
  // }

  // see IProAMMPoolActions
  function collectGovernmentFee() external override returns (uint256 governmentFeeQty) {
    (address feeTo, uint16 _governmentFeeBps) = factory.getFeeConfiguration();
    governmentFeeBps = _governmentFeeBps;
    if (collectedGovernmentFee > 0) {
      governmentFeeQty = collectedGovernmentFee - 1;
      // gas saving
      collectedGovernmentFee = 1;
      reinvestmentToken.safeTransfer(feeTo, governmentFeeQty);
    }
  }
}
