// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.5;

// import {IERC20Ext, IProAMMPool} from './interfaces/IProAMMPool.sol';
// // import './interfaces/IProAMMPoolDeployer.sol';
// // import './interfaces/IProAMMFactory.sol';
// // import './interfaces/callback/IProAMMMintCallback.sol';
// // import './interfaces/callback/IProAMMSwapCallback.sol';
// // import './interfaces/callback/IProAMMFlashCallback.sol';

// import {FullMath, LiqMath} from './libraries/LiqMath.sol';
// import {SwapMath} from './libraries/SwapMath.sol';

// import {SafeCast} from './libraries/SafeCast.sol';
// // import './libraries/Tick.sol';
// import {TickBitmap, TickMath} from './libraries/TickBitmap.sol';
// // import './libraries/Position.sol';


// contract ProAMMPool is IProAMMPool {
//     using SafeCast for uint256;
//     using SafeCast for int256;
//     using Tick for mapping(int24 => Tick.Info);
//     using TickBitmap for mapping(int16 => uint256);
//     using Position for mapping(bytes32 => Position.Info);
//     using Position for Position.Info;

//     /// see IProAMMPool for explanations of the immutables below
//     address public immutable override factory;
//     IERC20Ext public immutable override token0;
//     IERC20Ext public immutable override token1;
//     uint128 public immutable override maxLiquidityPerTick;
//     uint16 public immutable override swapFeeInBps;
//     int24 public immutable override tickSpacing;

//     // the current price
//     uint160 poolSqrtPriceX96;
//     // the current tick
//     int24 poolTick;
//     // the current protocol fee as a percentage of the swap fee taken on withdrawal
//     uint16 protocolFeeInBps;

//     // see IProAMMPool for explanations of the immutables below
//     uint256 public override poolFeeGrowthGlobal;
//     uint256 public override accumulatedProtocolFee;
//     uint128 public override poolLiquidity;
//     mapping(int24 => Tick.Info) public override ticks;
//     mapping(int16 => uint256) public override tickBitmap;
//     mapping(bytes32 => Position.Info) public override positions;

//     /// @dev Mutually exclusive reentrancy protection into the pool to/from a method. This method also prevents entrance
//     /// to a function before the pool is initialized. The reentrancy guard is required throughout the contract because
//     /// we use balance checks to determine the payment status of interactions such as mint, swap and flash.
//     modifier lock() {
//         require(slot0.unlocked, 'LOK');
//         slot0.unlocked = false;
//         _;
//         slot0.unlocked = true;
//     }

//     /// @dev Prevents calling a function from anyone except the address returned by IUniswapV3Factory#owner()
//     modifier onlyFactoryOwner() {
//         require(msg.sender == IUniswapV3Factory(factory).owner());
//         _;
//     }

//     constructor() {
//         int24 _tickSpacing;
//         (factory, token0, token1, fee, _tickSpacing) = IUniswapV3PoolDeployer(msg.sender).parameters();
//         tickSpacing = _tickSpacing;

//         maxLiquidityPerTick = Tick.tickSpacingToMaxLiquidityPerTick(_tickSpacing);
//     }

//     /// @dev Common checks for valid tick inputs.
//     function checkTicks(int24 tickLower, int24 tickUpper) private pure {
//         require(tickLower < tickUpper, 'TLU');
//         require(tickLower >= TickMath.MIN_TICK, 'TLM');
//         require(tickUpper <= TickMath.MAX_TICK, 'TUM');
//     }

//     /// @dev Returns the block timestamp truncated to 32 bits, i.e. mod 2**32. This method is overridden in tests.
//     function _blockTimestamp() internal view virtual returns (uint32) {
//         return uint32(block.timestamp); // truncation is desired
//     }

//     /// @dev Get the pool's balance of token0
//     /// @dev This function is gas optimized to avoid a redundant extcodesize check in addition to the returndatasize
//     /// check
//     function balance0() private view returns (uint256) {
//         (bool success, bytes memory data) =
//             token0.staticcall(abi.encodeWithSelector(IERC20Minimal.balanceOf.selector, address(this)));
//         require(success && data.length >= 32);
//         return abi.decode(data, (uint256));
//     }

//     /// @dev Get the pool's balance of token1
//     /// @dev This function is gas optimized to avoid a redundant extcodesize check in addition to the returndatasize
//     /// check
//     function balance1() private view returns (uint256) {
//         (bool success, bytes memory data) =
//             token1.staticcall(abi.encodeWithSelector(IERC20Minimal.balanceOf.selector, address(this)));
//         require(success && data.length >= 32);
//         return abi.decode(data, (uint256));
//     }

//     /// @inheritdoc IUniswapV3PoolActions
//     /// @dev not locked because it initializes unlocked
//     function initialize(uint160 sqrtPriceX96) external override {
//         require(slot0.sqrtPriceX96 == 0, 'AI');

//         int24 tick = TickMath.getTickAtSqrtRatio(sqrtPriceX96);

//         (uint16 cardinality, uint16 cardinalityNext) = observations.initialize(_blockTimestamp());

//         slot0 = Slot0({
//             sqrtPriceX96: sqrtPriceX96,
//             tick: tick,
//             observationIndex: 0,
//             observationCardinality: cardinality,
//             observationCardinalityNext: cardinalityNext,
//             feeProtocol: 0,
//             unlocked: true
//         });

//         emit Initialize(sqrtPriceX96, tick);
//     }

//     struct ModifyPositionParams {
//         // the address that owns the position
//         address owner;
//         // the lower and upper tick of the position
//         int24 tickLower;
//         int24 tickUpper;
//         // any change in liquidity
//         int128 liquidityDelta;
//     }

//     /// @dev Effect some changes to a position
//     /// @param params the position details and the change to the position's liquidity to effect
//     /// @return position a storage pointer referencing the position with the given owner and tick range
//     /// @return amount0 the amount of token0 owed to the pool, negative if the pool should pay the recipient
//     /// @return amount1 the amount of token1 owed to the pool, negative if the pool should pay the recipient
//     function _modifyPosition(ModifyPositionParams memory params)
//         private
//         noDelegateCall
//         returns (
//             Position.Info storage position,
//             int256 amount0,
//             int256 amount1
//         )
//     {
//         checkTicks(params.tickLower, params.tickUpper);

//         Slot0 memory _slot0 = slot0; // SLOAD for gas optimization

//         position = _updatePosition(
//             params.owner,
//             params.tickLower,
//             params.tickUpper,
//             params.liquidityDelta,
//             _slot0.tick
//         );

//         if (params.liquidityDelta != 0) {
//             if (_slot0.tick < params.tickLower) {
//                 // current tick is below the passed range; liquidity can only become in range by crossing from left to
//                 // right, when we'll need _more_ token0 (it's becoming more valuable) so user must provide it
//                 amount0 = SqrtPriceMath.getAmount0Delta(
//                     TickMath.getSqrtRatioAtTick(params.tickLower),
//                     TickMath.getSqrtRatioAtTick(params.tickUpper),
//                     params.liquidityDelta
//                 );
//             } else if (_slot0.tick < params.tickUpper) {
//                 // current tick is inside the passed range
//                 uint128 liquidityBefore = liquidity; // SLOAD for gas optimization

//                 // write an oracle entry
//                 (slot0.observationIndex, slot0.observationCardinality) = observations.write(
//                     _slot0.observationIndex,
//                     _blockTimestamp(),
//                     _slot0.tick,
//                     liquidityBefore,
//                     _slot0.observationCardinality,
//                     _slot0.observationCardinalityNext
//                 );

//                 amount0 = SqrtPriceMath.getAmount0Delta(
//                     _slot0.sqrtPriceX96,
//                     TickMath.getSqrtRatioAtTick(params.tickUpper),
//                     params.liquidityDelta
//                 );
//                 amount1 = SqrtPriceMath.getAmount1Delta(
//                     TickMath.getSqrtRatioAtTick(params.tickLower),
//                     _slot0.sqrtPriceX96,
//                     params.liquidityDelta
//                 );

//                 liquidity = LiquidityMath.addDelta(liquidityBefore, params.liquidityDelta);
//             } else {
//                 // current tick is above the passed range; liquidity can only become in range by crossing from right to
//                 // left, when we'll need _more_ token1 (it's becoming more valuable) so user must provide it
//                 amount1 = SqrtPriceMath.getAmount1Delta(
//                     TickMath.getSqrtRatioAtTick(params.tickLower),
//                     TickMath.getSqrtRatioAtTick(params.tickUpper),
//                     params.liquidityDelta
//                 );
//             }
//         }
//     }

//     /// @dev Gets and updates a position with the given liquidity delta
//     /// @param owner the owner of the position
//     /// @param tickLower the lower tick of the position's tick range
//     /// @param tickUpper the upper tick of the position's tick range
//     /// @param tick the current tick, passed to avoid sloads
//     function _updatePosition(
//         address owner,
//         int24 tickLower,
//         int24 tickUpper,
//         int128 liquidityDelta,
//         int24 tick
//     ) private returns (Position.Info storage position) {
//         position = positions.get(owner, tickLower, tickUpper);

//         uint256 _feeGrowthGlobal0X128 = feeGrowthGlobal0X128; // SLOAD for gas optimization
//         uint256 _feeGrowthGlobal1X128 = feeGrowthGlobal1X128; // SLOAD for gas optimization

//         // if we need to update the ticks, do it
//         bool flippedLower;
//         bool flippedUpper;
//         if (liquidityDelta != 0) {
//             uint32 time = _blockTimestamp();
//             (int56 tickCumulative, uint160 secondsPerLiquidityCumulativeX128) =
//                 observations.observeSingle(
//                     time,
//                     0,
//                     slot0.tick,
//                     slot0.observationIndex,
//                     liquidity,
//                     slot0.observationCardinality
//                 );

//             flippedLower = ticks.update(
//                 tickLower,
//                 tick,
//                 liquidityDelta,
//                 _feeGrowthGlobal0X128,
//                 _feeGrowthGlobal1X128,
//                 secondsPerLiquidityCumulativeX128,
//                 tickCumulative,
//                 time,
//                 false,
//                 maxLiquidityPerTick
//             );
//             flippedUpper = ticks.update(
//                 tickUpper,
//                 tick,
//                 liquidityDelta,
//                 _feeGrowthGlobal0X128,
//                 _feeGrowthGlobal1X128,
//                 secondsPerLiquidityCumulativeX128,
//                 tickCumulative,
//                 time,
//                 true,
//                 maxLiquidityPerTick
//             );

//             if (flippedLower) {
//                 tickBitmap.flipTick(tickLower, tickSpacing);
//             }
//             if (flippedUpper) {
//                 tickBitmap.flipTick(tickUpper, tickSpacing);
//             }
//         }

//         (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128) =
//             ticks.getFeeGrowthInside(tickLower, tickUpper, tick, _feeGrowthGlobal0X128, _feeGrowthGlobal1X128);

//         position.update(liquidityDelta, feeGrowthInside0X128, feeGrowthInside1X128);

//         // clear any tick data that is no longer needed
//         if (liquidityDelta < 0) {
//             if (flippedLower) {
//                 ticks.clear(tickLower);
//             }
//             if (flippedUpper) {
//                 ticks.clear(tickUpper);
//             }
//         }
//     }

//     /// @inheritdoc IUniswapV3PoolActions
//     /// @dev noDelegateCall is applied indirectly via _modifyPosition
//     function mint(
//         address recipient,
//         int24 tickLower,
//         int24 tickUpper,
//         uint128 amount,
//         bytes calldata data
//     ) external override lock returns (uint256 amount0, uint256 amount1) {
//         require(amount > 0);
//         (, int256 amount0Int, int256 amount1Int) =
//             _modifyPosition(
//                 ModifyPositionParams({
//                     owner: recipient,
//                     tickLower: tickLower,
//                     tickUpper: tickUpper,
//                     liquidityDelta: int256(amount).toInt128()
//                 })
//             );

//         amount0 = uint256(amount0Int);
//         amount1 = uint256(amount1Int);

//         uint256 balance0Before;
//         uint256 balance1Before;
//         if (amount0 > 0) balance0Before = balance0();
//         if (amount1 > 0) balance1Before = balance1();
//         IUniswapV3MintCallback(msg.sender).uniswapV3MintCallback(amount0, amount1, data);
//         if (amount0 > 0) require(balance0Before.add(amount0) <= balance0(), 'M0');
//         if (amount1 > 0) require(balance1Before.add(amount1) <= balance1(), 'M1');

//         emit Mint(msg.sender, recipient, tickLower, tickUpper, amount, amount0, amount1);
//     }

//     /// @inheritdoc IUniswapV3PoolActions
//     function collect(
//         address recipient,
//         int24 tickLower,
//         int24 tickUpper,
//         uint128 amount0Requested,
//         uint128 amount1Requested
//     ) external override lock returns (uint128 amount0, uint128 amount1) {
//         // we don't need to checkTicks here, because invalid positions will never have non-zero tokensOwed{0,1}
//         Position.Info storage position = positions.get(msg.sender, tickLower, tickUpper);

//         amount0 = amount0Requested > position.tokensOwed0 ? position.tokensOwed0 : amount0Requested;
//         amount1 = amount1Requested > position.tokensOwed1 ? position.tokensOwed1 : amount1Requested;

//         if (amount0 > 0) {
//             position.tokensOwed0 -= amount0;
//             TransferHelper.safeTransfer(token0, recipient, amount0);
//         }
//         if (amount1 > 0) {
//             position.tokensOwed1 -= amount1;
//             TransferHelper.safeTransfer(token1, recipient, amount1);
//         }

//         emit Collect(msg.sender, recipient, tickLower, tickUpper, amount0, amount1);
//     }

//     /// @inheritdoc IUniswapV3PoolActions
//     /// @dev noDelegateCall is applied indirectly via _modifyPosition
//     function burn(
//         int24 tickLower,
//         int24 tickUpper,
//         uint128 amount
//     ) external override lock returns (uint256 amount0, uint256 amount1) {
//         (Position.Info storage position, int256 amount0Int, int256 amount1Int) =
//             _modifyPosition(
//                 ModifyPositionParams({
//                     owner: msg.sender,
//                     tickLower: tickLower,
//                     tickUpper: tickUpper,
//                     liquidityDelta: -int256(amount).toInt128()
//                 })
//             );

//         amount0 = uint256(-amount0Int);
//         amount1 = uint256(-amount1Int);

//         if (amount0 > 0 || amount1 > 0) {
//             (position.tokensOwed0, position.tokensOwed1) = (
//                 position.tokensOwed0 + uint128(amount0),
//                 position.tokensOwed1 + uint128(amount1)
//             );
//         }

//         emit Burn(msg.sender, tickLower, tickUpper, amount, amount0, amount1);
//     }

    // temporary swap variables, some of which will be used to update the pool state
    struct SwapData {
        // the amount remaining to be swapped in/out of the input/output asset
        int256 deltaRemaining;
        // the amount needed to cross to the next tick
        int256 deltaNext;
        // the amount already swapped out/in of the output/input asset
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
        // amount of LP tokens paid as protocol fee
        uint256 protocolFee;
        // the current pool liquidity
        uint128 lp;
        // the current reinvestment liquidity
        uint128 lf;
        // collected liquidity
        uint256 lc;
        // total reinvestment token token supply
        uint256 sTotalSupply;
    }

    // swap will execute up to sqrtPriceLimit, even if exact output is not hit
    function swap(
        address recipient,
        int256 swapQty,
        bool isToken0,
        uint160 sqrtPriceLimit,
        bytes calldata data
    ) external nonreentrant returns (int256 deltaQty0, int256 deltaQty1) {
        require(swapQty != 0, '0 swapQty');
        bool isExactInput = swapQty > 0;
        // tick (token1Amt/token0Amt) will increase for token0Output or token1Input
        bool willUpTick = (!isExactInput && isToken0) || (isExactInput && !isToken0);
        require(
            willUpTick
                ? sqrtPriceLimit > poolSqrtPrice && sqrtPriceLimit < TickMath.MAX_SQRT_RATIO
                : sqrtPriceLimit < poolSqrtPrice && sqrtPriceLimit > TickMath.MIN_SQRT_RATIO
            'bad sqrtPriceLimit'
        );

        SwapData memory swapData =
            SwapData({
                deltaRemaining: swapQty,
                sqrtPc: poolSqrtPrice,
                currentTick: poolTick,
                lp: poolLiquidity,
                lf: poolReinvestmentLiquidity,
            });

        // continue swapping as long as we haven't used the entire input/output and haven't reached the price limit
        while (swapData.deltaRemaining != 0 && swapData.sqrtPc != sqrtPriceLimit) {
            (swapData.nextTick, swapData.initialized) = tickBitmap.nextInitializedTickWithinOneWord(
                swapData.currentTick,
                tickSpacing,
                willUpTick
            );

            // ensure that we do not overshoot the min/max tick, as the tick bitmap is not aware of these bounds
            if (swapData.nextTick < TickMath.MIN_TICK) {
                swapData.nextTick = TickMath.MIN_TICK;
            } else if (swapData.nextTick > TickMath.MAX_TICK) {
                swapData.nextTick = TickMath.MAX_TICK;
            }

            while (swapData.currentTick != swapData.nextTick) {
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
                swapData.deltaNext = SwapMath.calculateDeltaNext(
                    swapData.lp + swapData.lf,
                    swapData.sqrtPc,
                    swapData.sqrtPn,
                    swapFeeInBps,
                    isExactInput,
                    isToken0
                );
                if (isExactInput ? (swapData.deltaNext >= swapData.deltaRemaining) : (swapData.deltaNext <= swapData.deltaRemaining)) {
                    (swapData.actualDelta, swapData.lc, swapData.sqrtPn, swapData.protocolFee) = SwapMath.calculateSwapInTick(
                        SwapMath.SwapParams({
                            delta: swapData.deltaRemaining,
                            lpPlusLf: swapData.lp + swapData.lf,
                            lc: swapData.lc,
                            protocolFee: swapData.protocolFee,
                            sqrtPc: swapData.sqrtPc,
                            sqrtPn: swapData.sqrtPn,
                            swapFeeInBps: swapFeeInBps,
                            protocolFeeInBps: protocolFeeInBps,
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
                    
                    // if sTotalSupply has been initialized, update feeGlobal and Lp
                    if (swapData.sTotalSupply != 0) {
                        // update sTotalSupply, feeGrowthGlobal and lf
                        (swapData.sTotalSupply, swapData.feeGrowthGlobal, swapData.lf) = LiqMath.updateReinvestments(
                            swapData.lp,
                            swapData.lf,
                            swapData.lc,
                            swapData.sTotalSupply,
                            swapData.feeGrowthGlobal
                        );
                        // TODO: mint (sTotalSupply - initial total supply) to the pool
                        // maybe can account subtract total supply in special mint() method
                        reinvestmentToken.mint(sTotalSupply);
                        // update more pool variables
                        poolFeeGrowthGlobal = swapData.feeGrowthGlobal;
                        poolLiquidity = swapData.lp;
                        poolReinvestmentLiquidityLast = swapData.lf;
                    }
                } else {
                    // note that swapData.sqrtPn isn't updated 
                    (swapData.actualDelta, swapData.lc, ,swapData.protocolFee) = SwapMath.calculateSwapInTick(
                        SwapMath.SwapParams({
                            delta: swapData.deltaNext,
                            lpPlusLf: swapData.lp + swapData.lf,
                            lc: swapData.lc,
                            protocolFee: swapData.protocolFee,
                            sqrtPc: swapData.sqrtPc,
                            sqrtPn: swapData.sqrtPn,
                            swapFeeInBps: swapFeeInBps,
                            protocolFeeInBps: protocolFeeInBps,
                            isExactInput: isExactInput,
                            isToken0: isToken0,
                            calcFinalPrice: false
                        })
                    );

                    // reduce deltaRemaining by deltaNext
                    swapDelta.deltaRemaining -= swapDelta.deltaNext;
                    // update currentSqrtPrice
                    swapData.sqrtPc = swapData.sqrtPn;
                    // init sTotalSupply and feeGrowthGlobal if uninitialized
                    if (swapData.sTotalSupply == 0) {
                        swapData.feeGrowthGlobal = poolFeeGrowthGlobal;
                        swapData.sTotalSupply = reinvestmentToken.totalSupply();
                    }
                    // update sTotalSupply, feeGrowthGlobal and lf
                    (swapData.sTotalSupply, swapData.feeGrowthGlobal, swapData.lf) = LiqMath.updateReinvestments(
                        swapData.lp,
                        swapData.lf,
                        swapData.lc,
                        swapData.sTotalSupply,
                        swapData.feeGrowthGlobal
                    );
                }
            }
            // cross ticks if current tick == nextTick
            if (swapData.currentTick == swapData.nextTick) {
                if (swapData.initialized) {
                    int128 liquidityNet = ticks.cross();
                    swapData.lp += liquidityNet;
                }
                // if tick moves down, need to decrease by 1
                if (!willUpTick) swapData.currentTick = swapData.nextTick - 1;
            }
        }

        (deltaQty0, deltaQty1) = isToken0 ?
            (swapQty - swapData.deltaRemaining, swapData.actualDelta) :
            (state.actualDelta, swapQty - swapData.deltaRemaining);

        // handle token transfers, make and callback
        if (willUpTick) {
            // outbound deltaQty0 (negative), inbound deltaQty1 (positive)
            // transfer deltaQty0 to recipient
            if (deltaQty0 < 0) token0.safeTransfer(recipient, type(uint256).max - uint256(deltaQty0) + 1);

            // collect deltaQty1
            uint256 balance1Before = token1.balanceOf(address(this));
            IProAMMSwapCallback(msg.sender).proAMMSwapCallback(deltaQty0, deltaQty1, data);
            require(token1.balanceOf(address(this)) >= balance1Before + uint256(deltaQty1), 'lacking deltaQty1');
        } else {
            // inbound deltaQty0 (positive), outbound deltaQty1 (negative)
            // transfer deltaQty1 to recipient
            if (deltaQty1 < 0) token1.safeTransfer(recipient, type(uint256).max - uint256(deltaQty1) + 1);

            // collect deltaQty0
            uint256 balance0Before = token0.balanceOf(address(this));
            IProAMMSwapCallback(msg.sender).proAMMSwapCallback(deltaQty0, deltaQty1, data);
            require(token0.balanceOf(address(this)) >= balance0Before + uint256(deltaQty0), 'lacking deltaQty0');
        }

        emit Swap(msg.sender, recipient, deltaQty0, deltaQty1, poolSqrtPrice, poolLiquidity, poolTick);
    }

//     /// @inheritdoc IUniswapV3PoolActions
//     function flash(
//         address recipient,
//         uint256 amount0,
//         uint256 amount1,
//         bytes calldata data
//     ) external override lock noDelegateCall {
//         uint128 _liquidity = liquidity;
//         require(_liquidity > 0, 'L');

//         uint256 fee0 = FullMath.mulDivRoundingUp(amount0, fee, 1e6);
//         uint256 fee1 = FullMath.mulDivRoundingUp(amount1, fee, 1e6);
//         uint256 balance0Before = balance0();
//         uint256 balance1Before = balance1();

//         if (amount0 > 0) TransferHelper.safeTransfer(token0, recipient, amount0);
//         if (amount1 > 0) TransferHelper.safeTransfer(token1, recipient, amount1);

//         IUniswapV3FlashCallback(msg.sender).uniswapV3FlashCallback(fee0, fee1, data);

//         uint256 balance0After = balance0();
//         uint256 balance1After = balance1();

//         require(balance0Before.add(fee0) <= balance0After, 'F0');
//         require(balance1Before.add(fee1) <= balance1After, 'F1');

//         // sub is safe because we know balanceAfter is gt balanceBefore by at least fee
//         uint256 paid0 = balance0After - balance0Before;
//         uint256 paid1 = balance1After - balance1Before;

//         if (paid0 > 0) {
//             uint8 feeProtocol0 = slot0.feeProtocol % 16;
//             uint256 fees0 = feeProtocol0 == 0 ? 0 : paid0 / feeProtocol0;
//             if (uint128(fees0) > 0) protocolFees.token0 += uint128(fees0);
//             feeGrowthGlobal0X128 += FullMath.mulDiv(paid0 - fees0, FixedPoint128.Q128, _liquidity);
//         }
//         if (paid1 > 0) {
//             uint8 feeProtocol1 = slot0.feeProtocol >> 4;
//             uint256 fees1 = feeProtocol1 == 0 ? 0 : paid1 / feeProtocol1;
//             if (uint128(fees1) > 0) protocolFees.token1 += uint128(fees1);
//             feeGrowthGlobal1X128 += FullMath.mulDiv(paid1 - fees1, FixedPoint128.Q128, _liquidity);
//         }

//         emit Flash(msg.sender, recipient, amount0, amount1, paid0, paid1);
//     }

//     /// @inheritdoc IUniswapV3PoolOwnerActions
//     function setFeeProtocol(uint8 feeProtocol0, uint8 feeProtocol1) external override lock onlyFactoryOwner {
//         require(
//             (feeProtocol0 == 0 || (feeProtocol0 >= 4 && feeProtocol0 <= 10)) &&
//                 (feeProtocol1 == 0 || (feeProtocol1 >= 4 && feeProtocol1 <= 10))
//         );
//         uint8 feeProtocolOld = slot0.feeProtocol;
//         slot0.feeProtocol = feeProtocol0 + (feeProtocol1 << 4);
//         emit SetFeeProtocol(feeProtocolOld % 16, feeProtocolOld >> 4, feeProtocol0, feeProtocol1);
//     }

//     /// @inheritdoc IUniswapV3PoolOwnerActions
//     function collectProtocol(
//         address recipient,
//         uint128 amount0Requested,
//         uint128 amount1Requested
//     ) external override lock onlyFactoryOwner returns (uint128 amount0, uint128 amount1) {
//         amount0 = amount0Requested > protocolFees.token0 ? protocolFees.token0 : amount0Requested;
//         amount1 = amount1Requested > protocolFees.token1 ? protocolFees.token1 : amount1Requested;

//         if (amount0 > 0) {
//             if (amount0 == protocolFees.token0) amount0--; // ensure that the slot is not cleared, for gas savings
//             protocolFees.token0 -= amount0;
//             TransferHelper.safeTransfer(token0, recipient, amount0);
//         }
//         if (amount1 > 0) {
//             if (amount1 == protocolFees.token1) amount1--; // ensure that the slot is not cleared, for gas savings
//             protocolFees.token1 -= amount1;
//             TransferHelper.safeTransfer(token1, recipient, amount1);
//         }

//         emit CollectProtocol(msg.sender, recipient, amount0, amount1);
//     }
// }