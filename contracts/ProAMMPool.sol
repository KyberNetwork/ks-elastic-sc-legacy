// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.4;

import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {Clones} from '@openzeppelin/contracts/proxy/Clones.sol';

import {IERC20, IProAMMPool} from './interfaces/IProAMMPool.sol';
import {IProAMMFactory} from './interfaces/IProAMMFactory.sol';
import {IReinvestmentToken} from './interfaces/IReinvestmentToken.sol';
import {IProAMMMintCallback} from './interfaces/callback/IProAMMMintCallback.sol';
import {IProAMMSwapCallback} from './interfaces/callback/IProAMMSwapCallback.sol';
import {IProAMMFlashCallback} from './interfaces/callback/IProAMMFlashCallback.sol';

import {LiqDeltaMath} from './libraries/LiqDeltaMath.sol';
import {QtyDeltaMath} from './libraries/QtyDeltaMath.sol';
import {MathConstants as C} from './libraries/MathConstants.sol';
import {ReinvestmentMath} from './libraries/ReinvestmentMath.sol';
import {SwapMath} from './libraries/SwapMath.sol';
import {FullMath} from './libraries/FullMath.sol';
import {SafeCast} from './libraries/SafeCast.sol';
import {TickMath} from './libraries/TickMath.sol';
import {ProAMMPoolTicksState} from './ProAMMPoolTicksState.sol';

contract ProAMMPool is IProAMMPool, ProAMMPoolTicksState {
  using Clones for address;
  using SafeCast for uint256;
  using SafeCast for int256;
  using SafeERC20 for IERC20;
  using SafeERC20 for IReinvestmentToken;

  address private constant LIQUIDITY_LOCKUP_ADDRESS = 0xD444422222222222222222222222222222222222;
  uint128 private constant MIN_LIQUIDITY = 100000;

  /// see IProAMMPool for explanations of the immutables below
  IProAMMFactory public immutable override factory;
  IERC20 public immutable override token0;
  IERC20 public immutable override token1;
  IReinvestmentToken public immutable override reinvestmentToken;
  uint128 public immutable override maxLiquidityPerTick;
  uint16 public immutable override swapFeeBps;
  int24 public immutable override tickSpacing;

  // see IProAMMPool#getPoolState for explanations of the variables below
  uint160 internal poolSqrtPrice;
  int24 internal poolTick;
  bool private locked;
  // see IProAMMPool#getReinvestmentState for explanations of the variables below
  uint128 internal poolLiquidity;
  uint128 internal poolReinvestmentLiquidity;
  uint128 internal poolReinvestmentLiquidityLast;
  uint256 internal poolFeeGrowthGlobal;

  /// @dev Mutually exclusive reentrancy protection into the pool from/to a method.
  /// Also prevents entrance to pool actions prior to initalization
  modifier lock() {
    require(locked == false, 'locked');
    locked = true;
    _;
    locked = false;
  }

  constructor() {
    // fetch data from factory constructor
    (
      address _factory,
      address _token0,
      address _token1,
      uint16 _swapFeeBps,
      int24 _tickSpacing
    ) = IProAMMFactory(msg.sender).parameters();
    factory = IProAMMFactory(_factory);
    token0 = IERC20(_token0);
    token1 = IERC20(_token1);
    swapFeeBps = _swapFeeBps;
    tickSpacing = _tickSpacing;

    maxLiquidityPerTick = calcMaxLiquidityPerTick(_tickSpacing);
    IReinvestmentToken _reinvestmentToken = IReinvestmentToken(
      IProAMMFactory(_factory).reinvestmentTokenMaster().clone()
    );
    _reinvestmentToken.initialize();
    reinvestmentToken = _reinvestmentToken;
    locked = true;
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

  // TODO move _poolLiquidity to getReinvestmentState to save 1 slot
  function getPoolState()
    external
    view
    override
    returns (
      uint160 _poolSqrtPrice,
      int24 _poolTick,
      bool _locked,
      uint128 _poolLiquidity
    )
  {
    return (poolSqrtPrice, poolTick, locked, poolLiquidity);
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
    return (poolFeeGrowthGlobal, poolReinvestmentLiquidity, poolReinvestmentLiquidityLast);
  }

  /// see IProAMMPoolActions
  function unlockPool(uint160 initialSqrtPrice, bytes calldata data)
    external
    override
    returns (uint256 qty0, uint256 qty1)
  {
    require(poolSqrtPrice == 0, 'already inited');
    locked = false; // unlock the pool
    // initial tick bounds (min & max price limits) are checked in this function
    int24 initialTick = TickMath.getTickAtSqrtRatio(initialSqrtPrice);
    (qty0, qty1) = QtyDeltaMath.getQtysForInitialLockup(initialSqrtPrice, MIN_LIQUIDITY);
    IProAMMMintCallback(msg.sender).proAMMMintCallback(qty0, qty1, data);
    // because of price bounds, qty0 and qty1 >= 1
    require(qty0 <= poolBalToken0(), 'lacking qty0');
    require(qty1 <= poolBalToken1(), 'lacking qty1');
    poolTick = initialTick;
    poolSqrtPrice = initialSqrtPrice;
    poolReinvestmentLiquidity = MIN_LIQUIDITY;
    poolReinvestmentLiquidityLast = MIN_LIQUIDITY;
    reinvestmentToken.mint(LIQUIDITY_LOCKUP_ADDRESS, MIN_LIQUIDITY);
    emit Initialize(initialSqrtPrice, poolTick);
  }

  /// @dev Make changes to a position
  /// @param posData the position details and the change to the position's liquidity to effect
  /// @return qty0 token0 qty owed to the pool, negative if the pool should pay the recipient
  /// @return qty1 token1 qty owed to the pool, negative if the pool should pay the recipient
  function _tweakPosition(UpdatePositionData memory posData)
    private
    returns (
      int256 qty0,
      int256 qty1,
      uint256 feesClaimable
    )
  {
    require(posData.tickLower < posData.tickUpper, 'invalid ticks');
    require(posData.tickLower >= TickMath.MIN_TICK, 'invalid lower tick');
    require(posData.tickUpper <= TickMath.MAX_TICK, 'invalid upper tick');

    // SLOADs for gas optimization
    uint160 _poolSqrtPrice = poolSqrtPrice;
    int24 _poolTick = poolTick;
    uint128 lp = poolLiquidity;
    uint128 lf = poolReinvestmentLiquidity;
    uint256 _feeGrowthGlobal = poolFeeGrowthGlobal;

    {
      uint128 lfLast = poolReinvestmentLiquidityLast;
      uint256 rMintQty = ReinvestmentMath.calcrMintQty(
        lf,
        lfLast,
        lp,
        reinvestmentToken.totalSupply()
      );
      if (rMintQty != 0) {
        mintRTokens(rMintQty);
        // lp != 0 because lp = 0 => rMintQty = 0
        _feeGrowthGlobal += FullMath.mulDivFloor(rMintQty, C.TWO_POW_96, lp);
        poolFeeGrowthGlobal = _feeGrowthGlobal;
      }
      // update poolReinvestmentLiquidityLast
      poolReinvestmentLiquidityLast = lf;
    }

    feesClaimable = _updatePosition(
      posData,
      _poolTick,
      _feeGrowthGlobal,
      maxLiquidityPerTick,
      tickSpacing
    );
    if (feesClaimable != 0) reinvestmentToken.safeTransfer(posData.owner, feesClaimable);

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

  /// see IProAMMPoolActions
  function mint(
    address recipient,
    int24 tickLower,
    int24 tickUpper,
    uint128 qty,
    bytes calldata data
  )
    external
    override
    lock
    returns (
      uint256 qty0,
      uint256 qty1,
      uint256 feesClaimable
    )
  {
    require(qty > 0, '0 qty');
    require(factory.isWhitelistedNFTManager(msg.sender), 'forbidden');
    int256 qty0Int;
    int256 qty1Int;
    (qty0Int, qty1Int, feesClaimable) = _tweakPosition(
      UpdatePositionData({
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
  )
    external
    override
    lock
    returns (
      uint256 qty0,
      uint256 qty1,
      uint256 feesClaimable
    )
  {
    require(qty > 0, '0 qty');
    int256 qty0Int;
    int256 qty1Int;
    (qty0Int, qty1Int, feesClaimable) = _tweakPosition(
      UpdatePositionData({
        owner: msg.sender,
        tickLower: tickLower,
        tickUpper: tickUpper,
        liquidityDelta: int256(type(uint256).max - uint256(qty) + 1).toInt128()
      })
    );

    if (qty0Int < 0) {
      qty0 = qty0Int.revToUint256();
      token0.safeTransfer(msg.sender, qty0);
    }
    if (qty1Int < 0) {
      qty1 = qty1Int.revToUint256();
      token1.safeTransfer(msg.sender, qty1);
    }

    emit BurnLP(msg.sender, tickLower, tickUpper, qty, qty0, qty1);
  }

  function burnRTokens(uint256 _qty) external override lock returns (uint256 qty0, uint256 qty1) {
    // SLOADs for gas optimizations
    uint128 lp = poolLiquidity;
    uint256 lf = poolReinvestmentLiquidity;
    uint160 pc = poolSqrtPrice;
    uint256 rTotalSupply = reinvestmentToken.totalSupply();
    // calculate rMintQty
    uint256 rMintQty = ReinvestmentMath.calcrMintQty(
      lf,
      poolReinvestmentLiquidityLast,
      lp,
      rTotalSupply
    );

    // mint tokens to pool and increment fee growth if needed
    if (rMintQty != 0) {
      mintRTokens(rMintQty);
      rTotalSupply += rMintQty;
      // lp != 0 because lp = 0 => rMintQty = 0
      poolFeeGrowthGlobal += FullMath.mulDivFloor(rMintQty, C.TWO_POW_96, lp);
    }

    // burn _qty of caller
    // position manager should transfer _qty from user to itself, but not send it to the pool
    // for direct calls, msg.sender should have sufficient balance
    reinvestmentToken.burn(msg.sender, _qty);
    // rTotalSupply is the reinvestment token supply after minting, but before burning
    uint256 lfDelta = FullMath.mulDivFloor(_qty, lf, rTotalSupply);
    uint128 lfNew = (lf - lfDelta).toUint128();
    poolReinvestmentLiquidity = lfNew;
    poolReinvestmentLiquidityLast = lfNew;
    // finally, calculate and send token quantities to user
    uint256 tokenQty = QtyDeltaMath.getQty0FromBurnRTokens(pc, lfDelta);
    if (tokenQty > 0) token0.safeTransfer(msg.sender, tokenQty);
    tokenQty = QtyDeltaMath.getQty1FromBurnRTokens(pc, lfDelta);
    if (tokenQty > 0) token1.safeTransfer(msg.sender, tokenQty);
    emit BurnRTokens(msg.sender, _qty, qty0, qty1);
  }

  // temporary swap variables, some of which will be used to update the pool state
  struct SwapData {
    int256 deltaRemaining; // the specified amount (could be tokenIn or tokenOut)
    bool isToken0; // is soureQty token0 or token1?
    bool isExactInput; // is soureQty input or output?
    int256 actualDelta; // the opposite amout of soureQty
    uint160 sqrtPc; // current sqrt(price), multiplied by 2^96
    int24 currentTick; // the tick associated with the current price
    uint128 lp; // the current pool liquidity
    uint128 lf; // the current reinvestment liquidity
    // variable only load when crossing a tick
    uint128 lfLast; // collected liquidity
    uint256 rTotalSupply; // cache of total reinvestment token supply
    uint256 rTotalSupplyInitial; // initial value of rTotalSupply
    uint256 feeGrowthGlobal; // cache of fee growth of the reinvestment token, multiplied by 2^96
  }

  struct SwapStep {
    int24 nextTick; // the tick associated with the next price
    bool initialized; // whether nextTick is initialized
    uint160 nextSqrtP; // the price of nextTick
  }

  // see IProAMMPoolActions
  // swaps will execute up to sqrtPriceLimit, even if target swapQty is not reached
  function swap(
    address recipient,
    int256 swapQty,
    bool isToken0,
    uint160 sqrtPriceLimit,
    bytes calldata data
  ) external override lock returns (int256 deltaQty0, int256 deltaQty1) {
    SwapData memory swapData;
    swapData.deltaRemaining = swapQty;
    swapData.isToken0 = isToken0;
    require(swapData.deltaRemaining != 0, '0 swapQty');
    swapData.isExactInput = swapData.deltaRemaining > 0;
    // tick (token1Amt/token0Amt) will increase for swaping from token1 to token0
    bool willUpTick = (!swapData.isExactInput && isToken0) || (swapData.isExactInput && !isToken0);
    // initialize other params of swapData
    swapData.sqrtPc = poolSqrtPrice;
    swapData.currentTick = poolTick;
    swapData.lp = poolLiquidity;
    swapData.lf = poolReinvestmentLiquidity;

    require(
      willUpTick
        ? (sqrtPriceLimit > swapData.sqrtPc && sqrtPriceLimit < TickMath.MAX_SQRT_RATIO)
        : (sqrtPriceLimit < swapData.sqrtPc && sqrtPriceLimit > TickMath.MIN_SQRT_RATIO),
      'bad sqrtPriceLimit'
    );

    // continue swapping while specified input/output isn't satisfied or price limit not reached
    while (swapData.deltaRemaining != 0 && swapData.sqrtPc != sqrtPriceLimit) {
      SwapStep memory step;
      (step.nextTick, step.initialized) = nextInitializedTick(
        swapData.currentTick,
        tickSpacing,
        willUpTick
      );

      // ensure that next tick does not exceed min / max tick
      if (step.nextTick < TickMath.MIN_TICK) {
        step.nextTick = TickMath.MIN_TICK;
      } else if (step.nextTick > TickMath.MAX_TICK) {
        step.nextTick = TickMath.MAX_TICK;
      }

      // get next sqrt price for the new tick
      step.nextSqrtP = TickMath.getSqrtRatioAtTick(step.nextTick);
      // local scope for targetSqrtP, deltaNext, actualDelta and lc
      {
        uint160 targetSqrtP = step.nextSqrtP;
        // ensure next sqrtPrice (and its corresponding tick) does not exceed price limit
        if (willUpTick ? (step.nextSqrtP > sqrtPriceLimit) : (step.nextSqrtP < sqrtPriceLimit)) {
          targetSqrtP = sqrtPriceLimit;
        }

        int256 deltaNext;
        int256 actualDelta;
        uint256 lc;
        (deltaNext, actualDelta, lc, swapData.sqrtPc) = SwapMath.computeSwapStep(
          swapData.lp + swapData.lf,
          swapData.sqrtPc,
          targetSqrtP,
          swapFeeBps,
          swapData.deltaRemaining,
          swapData.isExactInput,
          swapData.isToken0
        );
        swapData.deltaRemaining -= deltaNext;
        swapData.actualDelta += actualDelta;
        swapData.lf += lc.toUint128();
      }

      // swap cross next tick
      if (swapData.sqrtPc == step.nextSqrtP) {
        if (step.initialized) {
          if (swapData.rTotalSupplyInitial == 0) {
            swapData.lfLast = poolReinvestmentLiquidityLast;
            swapData.feeGrowthGlobal = poolFeeGrowthGlobal;
            swapData.rTotalSupplyInitial = reinvestmentToken.totalSupply();
            swapData.rTotalSupply = swapData.rTotalSupplyInitial;
          }

          // update rTotalSupply, feeGrowthGlobal and lf
          uint256 rMintQty = ReinvestmentMath.calcrMintQty(
            swapData.lf,
            swapData.lfLast,
            swapData.lp,
            swapData.rTotalSupply
          );
          if (rMintQty != 0) {
            swapData.rTotalSupply += rMintQty;
            swapData.feeGrowthGlobal += FullMath.mulDivFloor(rMintQty, C.TWO_POW_96, swapData.lp);
          }
          swapData.lfLast = swapData.lf;

          int128 liquidityNet = crossToTick(step.nextTick, swapData.feeGrowthGlobal);
          // need to switch signs for decreasing tick
          if (!willUpTick) liquidityNet = -liquidityNet;
          swapData.lp = LiqDeltaMath.addLiquidityDelta(swapData.lp, liquidityNet);
        }
        swapData.currentTick = willUpTick ? step.nextTick : step.nextTick - 1;
      } else {
        swapData.currentTick = TickMath.getTickAtSqrtRatio(swapData.sqrtPc);
      }
    }

    // calculate and mint reinvestment tokens if necessary
    // also calculate government fee and transfer to feeTo
    if (swapData.rTotalSupplyInitial != 0) {
      if (swapData.rTotalSupply > swapData.rTotalSupplyInitial) {
        mintRTokens(swapData.rTotalSupply - swapData.rTotalSupplyInitial);
      }
      poolReinvestmentLiquidityLast = swapData.lfLast;
      poolFeeGrowthGlobal = swapData.feeGrowthGlobal;
    }

    // update pool variables
    poolLiquidity = swapData.lp;
    poolReinvestmentLiquidity = swapData.lf;
    // sload optimize
    poolSqrtPrice = swapData.sqrtPc;
    poolTick = swapData.currentTick;

    (deltaQty0, deltaQty1) = isToken0
      ? (swapQty - swapData.deltaRemaining, swapData.actualDelta)
      : (swapData.actualDelta, swapQty - swapData.deltaRemaining);

    // handle token transfers, make and callback
    if (willUpTick) {
      // outbound deltaQty0 (negative), inbound deltaQty1 (positive)
      // transfer deltaQty0 to recipient
      if (deltaQty0 < 0) token0.safeTransfer(recipient, deltaQty0.revToUint256());

      // collect deltaQty1
      uint256 balance1Before = poolBalToken1();
      IProAMMSwapCallback(msg.sender).proAMMSwapCallback(deltaQty0, deltaQty1, data);
      require(poolBalToken1() >= balance1Before + uint256(deltaQty1), 'lacking deltaQty1');
    } else {
      // inbound deltaQty0 (positive), outbound deltaQty1 (negative)
      // transfer deltaQty1 to recipient
      if (deltaQty1 < 0) token1.safeTransfer(recipient, deltaQty1.revToUint256());

      // collect deltaQty0
      uint256 balance0Before = poolBalToken0();
      IProAMMSwapCallback(msg.sender).proAMMSwapCallback(deltaQty0, deltaQty1, data);
      require(poolBalToken0() >= balance0Before + uint256(deltaQty0), 'lacking deltaQty0');
    }

    emit Swap(
      msg.sender,
      recipient,
      deltaQty0,
      deltaQty1,
      swapData.sqrtPc,
      swapData.lp,
      swapData.currentTick
    );
  }

  function mintRTokens(uint256 rMintQty) internal {
    reinvestmentToken.mint(address(this), rMintQty);
    // fetch governmentFeeBps
    (address feeTo, uint16 governmentFeeBps) = factory.feeConfiguration();
    if (governmentFeeBps > 0) {
      // take a cut of fees for government
      uint256 governmentFeeQty = (rMintQty * governmentFeeBps) / C.BPS;
      // transfer rTokens to feeTo
      reinvestmentToken.safeTransfer(feeTo, governmentFeeQty);
    }
  }

  // TODO flash
}
