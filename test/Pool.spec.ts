import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {BigNumber as BN, Wallet} from 'ethers';
import chai from 'chai';
const {solidity, loadFixture} = waffle;
chai.use(solidity);

import {MockFactory, MockPool, MockToken, MockToken__factory, MockPool__factory} from '../typechain';
import {QuoterV2, QuoterV2__factory, MockCallbacks, MockCallbacks__factory} from '../typechain';

import {MIN_LIQUIDITY, MIN_TICK, MAX_TICK, MIN_SQRT_RATIO, MAX_SQRT_RATIO} from './helpers/helper';
import {ZERO_ADDRESS, ZERO, ONE, MAX_UINT, PRECISION, TWO, BPS, NEGATIVE_ONE} from './helpers/helper';
import {deployMockFactory, getTicksPrevious} from './helpers/setup';
import {genRandomBN} from './helpers/genRandomBN';
import {logBalanceChange, logSwapState, SwapTitle} from './helpers/logger';
import {encodePriceSqrt, getMaxTick, getMinTick, getNearestSpacedTickAtPrice} from './helpers/utils';
import {getPriceFromTick, snapshotGasCost} from './helpers/utils';

let factory: MockFactory;
let token0: MockToken;
let token1: MockToken;
let quoter: QuoterV2;
let poolBalToken0: BN;
let poolBalToken1: BN;
let poolArray: MockPool[] = [];
let pool: MockPool;
let callback: MockCallbacks;
let swapFeeBpsArray = [5, 30];
let swapFeeBps = swapFeeBpsArray[0];
let tickDistanceArray = [10, 60];
let tickDistance = tickDistanceArray[0];
let vestingPeriod = 100;

let minTick = getMinTick(tickDistance);
let maxTick = getMaxTick(tickDistance);
let ticksPrevious: [BN, BN] = [MIN_TICK, MIN_TICK];
let initialPrice: BN;
let nearestTickToPrice: number; // the floor of tick that mod tickDistance = 0
let tickLower: number;
let tickUpper: number;
let tickLowerData: any;
let tickUpperData: any;
let positionData: any;

class Fixtures {
  constructor (
    public factory: MockFactory,
    public poolArray: MockPool[],
    public token0: MockToken,
    public token1: MockToken,
    public callback: MockCallbacks,
    public quoter: QuoterV2
  ) {}
}

describe('Pool', () => {
  const [user, admin, configMaster] = waffle.provider.getWallets();

  async function fixture (): Promise<Fixtures> {
    let factory = await deployMockFactory(admin, vestingPeriod);
    const PoolContract = (await ethers.getContractFactory('MockPool')) as MockPool__factory;
    // add any newly defined tickDistance apart from default ones
    for (let i = 0; i < swapFeeBpsArray.length; i++) {
      if ((await factory.feeAmountTickSpacing(swapFeeBpsArray[i])) == 0) {
        await factory.connect(admin).enableSwapFee(swapFeeBpsArray[i], tickDistanceArray[i]);
      }
    }

    const MockTokenContract = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    const tokenA = await MockTokenContract.deploy('USDC', 'USDC', PRECISION.mul(PRECISION));
    const tokenB = await MockTokenContract.deploy('DAI', 'DAI', PRECISION.mul(PRECISION));
    token0 = tokenA.address.toLowerCase() < tokenB.address.toLowerCase() ? tokenA : tokenB;
    token1 = token0.address == tokenA.address ? tokenB : tokenA;

    // create pools
    let poolArray = [];
    for (let i = 0; i < swapFeeBpsArray.length; i++) {
      await factory.createPool(token0.address, token1.address, swapFeeBpsArray[i]);
      const poolAddress = await factory.getPool(token0.address, token1.address, swapFeeBpsArray[i]);
      poolArray.push(PoolContract.attach(poolAddress));
    }

    const CallbackContract = (await ethers.getContractFactory('MockCallbacks')) as MockCallbacks__factory;
    let callback = await CallbackContract.deploy(tokenA.address, tokenB.address);
    // user give token approval to callbacks
    await tokenA.connect(user).approve(callback.address, MAX_UINT);
    await tokenB.connect(user).approve(callback.address, MAX_UINT);

    const QuoterV2Contract = (await ethers.getContractFactory('QuoterV2')) as QuoterV2__factory;
    let quoter = await QuoterV2Contract.deploy(factory.address);

    return new Fixtures(factory, poolArray, token0, token1, callback, quoter);
  }

  beforeEach('load fixture', async () => {
    ({factory, poolArray, token0, token1, callback, quoter} = await loadFixture(fixture));
    pool = poolArray[0];
  });

  describe('#test pool deployment and initialization', async () => {
    it('should have initialized required settings', async () => {
      expect(await pool.factory()).to.be.eql(factory.address);
      expect(await pool.token0()).to.be.eql(token0.address);
      expect(await pool.token1()).to.be.eql(token1.address);
      expect(await pool.swapFeeBps()).to.be.eql(swapFeeBps);
      expect(await pool.tickDistance()).to.be.eql(tickDistance);
      expect(await pool.maxTickLiquidity()).to.be.gt(ZERO);
      let result = await pool.getLiquidityState();
      expect(result.reinvestL).to.be.eql(ZERO);
      expect(result.reinvestLLast).to.be.eql(ZERO);
    });
  });

  describe('#unlockPool', async () => {
    before('set initial price', async () => {
      initialPrice = await getPriceFromTick(10);
    });

    it('should only be able to call unlockPool once', async () => {
      await callback.connect(user).unlockPool(pool.address, initialPrice, '0x');

      await expect(callback.unlockPool(pool.address, initialPrice, '0x')).to.be.revertedWith('already inited');
    });

    it('should fail to unlockPool for non-compliant ERC20 tokens', async () => {
      const PoolContract = (await ethers.getContractFactory('MockPool')) as MockPool__factory;
      await factory.createPool(user.address, admin.address, swapFeeBps);
      let badPool = PoolContract.attach(await factory.getPool(user.address, admin.address, swapFeeBps));
      await expect(callback.connect(user).unlockPool(badPool.address, initialPrice, '0x')).to.be.reverted;

      // use valid token0 so that poolBalToken1() will revert
      let badAddress = '0xffffffffffffffffffffffffffffffffffffffff';
      await factory.createPool(token0.address, badAddress, swapFeeBps);
      badPool = PoolContract.attach(await factory.getPool(token0.address, badAddress, swapFeeBps));
      await expect(callback.connect(user).unlockPool(badPool.address, initialPrice, '0x')).to.be.reverted;
    });

    it('should fail if initial tick is outside of min and max ticks', async () => {
      // initial tick < lower tick
      await expect(callback.unlockPool(pool.address, ZERO, '0x')).to.be.revertedWith('R');
      await expect(callback.unlockPool(pool.address, MIN_SQRT_RATIO.sub(ONE), '0x')).to.be.revertedWith('R');
      // initial tick > upper tick
      await expect(callback.unlockPool(pool.address, await getPriceFromTick(MAX_TICK), '0x')).to.be.revertedWith('R');
    });

    it('should fail to mint liquidity if callback fails to send enough qty to pool', async () => {
      // send insufficient token0
      await expect(callback.badUnlockPool(pool.address, initialPrice, true, false)).to.be.revertedWith('lacking qty0');

      // send insufficient token1
      await expect(callback.badUnlockPool(pool.address, initialPrice, false, true)).to.be.revertedWith('lacking qty1');
    });

    it('should have initialized the pool and created first position', async () => {
      await callback.connect(user).unlockPool(pool.address, initialPrice, '0x');

      let poolState = await pool.getPoolState();
      expect(poolState.sqrtP).to.be.eql(initialPrice);
      expect(poolState.currentTick).to.be.eql(10);
      expect(poolState.nearestCurrentTick).to.be.eq(MIN_TICK);
      expect(poolState.locked).to.be.false;

      let liquidityState = await pool.getLiquidityState();
      expect(liquidityState.baseL).to.be.eql(ZERO);
      expect(liquidityState.reinvestL).to.be.eql(MIN_LIQUIDITY);
      expect(liquidityState.reinvestLLast).to.be.eql(MIN_LIQUIDITY);
      // expect(result2._poolFeeGrowthGlobal).to.be.eql(ZERO);

      expect(await pool.secondsPerLiquidityGlobal()).to.be.eql(ZERO);
      expect(await pool.secondsPerLiquidityUpdateTime()).to.be.eql(0);
    });

    it('#gas [ @skip-on-coverage ]', async () => {
      const tx = await callback.connect(user).unlockPool(pool.address, initialPrice, '0x');
      await snapshotGasCost(tx);
    });

    it('should have emitted Initialize event', async () => {
      await expect(callback.connect(user).unlockPool(pool.address, initialPrice, '0x'))
        .to.emit(pool, 'Initialize')
        .withArgs(initialPrice, 10);
    });

    it('should init if initial tick is equal to the lower tick', async () => {
      // initial tick = lower tick
      await expect(callback.unlockPool(pool.address, MIN_SQRT_RATIO, '0x')).to.not.be.reverted;
    });

    it('should init if initial tick is equal to the upper tick - 1', async () => {
      // initial tick = upper tick
      await expect(callback.unlockPool(pool.address, await getPriceFromTick(MAX_TICK.sub(ONE)), '0x')).to.not.be
        .reverted;
    });
  });

  describe('#mint', async () => {
    it('should fail if pool is not unlocked', async () => {
      await expect(
        callback.mint(pool.address, user.address, 0, 100, ticksPrevious, PRECISION, '0x')
      ).to.be.revertedWith('locked');
    });

    describe('after unlockPool', async () => {
      beforeEach('unlock pool with initial price of 2:1', async () => {
        await callback.unlockPool(pool.address, encodePriceSqrt(TWO, ONE), '0x');
        // whitelist callback as NFT manager
        await factory.connect(admin).addNFTManager(callback.address);
      });

      it('should fail if called from non-whitelist address', async () => {
        await factory.connect(admin).removeNFTManager(callback.address);
        await expect(
          callback.mint(pool.address, user.address, 0, 100, ticksPrevious, PRECISION, '0x')
        ).to.be.revertedWith('forbidden');
      });

      it('should fail if ticks are not in tick distance', async () => {
        await expect(
          callback.mint(pool.address, user.address, 4, 8, ticksPrevious, PRECISION, '0x')
        ).to.be.revertedWith('tick not in distance');
      });

      it('should fail if tickLower > tickUpper', async () => {
        await expect(
          callback.mint(pool.address, user.address, 9, 8, ticksPrevious, PRECISION, '0x')
        ).to.be.revertedWith('invalid tick range');
      });

      it('should fail if lower tick < MIN_TICK', async () => {
        await expect(
          callback.mint(pool.address, user.address, MIN_TICK.sub(ONE), 0, ticksPrevious, PRECISION, '0x')
        ).to.be.revertedWith('invalid lower tick');
      });

      it('should fail if upper tick > MAX_TICK', async () => {
        await expect(
          callback.mint(pool.address, user.address, 0, MAX_TICK.add(ONE), ticksPrevious, PRECISION, '0x')
        ).to.be.revertedWith('invalid upper tick');
      });

      it('should fail if liquidity added exceeds maxTickLiquidity', async () => {
        await expect(
          callback.mint(
            pool.address,
            user.address,
            0,
            10,
            ticksPrevious,
            (await pool.maxTickLiquidity()).add(ONE),
            '0x'
          )
        ).to.be.revertedWith('> max liquidity');
      });

      it('should fail if liquidity gross of a tick exceeds maxTickLiquidity', async () => {
        let maxLiquidityGross = await pool.maxTickLiquidity();
        // mint new position with MIN_LIQUIDITY
        await callback.mint(
          pool.address,
          user.address,
          minTick + tickDistance,
          maxTick - tickDistance,
          ticksPrevious,
          MIN_LIQUIDITY,
          '0x'
        );
        let exceedingLiquidity = maxLiquidityGross.sub(MIN_LIQUIDITY).add(ONE);

        await expect(
          callback.mint(
            pool.address,
            user.address,
            minTick + tickDistance,
            maxTick,
            ticksPrevious,
            exceedingLiquidity,
            '0x'
          )
        ).to.be.revertedWith('> max liquidity');

        await expect(
          callback.mint(
            pool.address,
            user.address,
            minTick,
            maxTick - tickDistance,
            ticksPrevious,
            exceedingLiquidity,
            '0x'
          )
        ).to.be.revertedWith('> max liquidity');

        // should work if liquidityGross = maxTickLiquidity
        await expect(
          callback.mint(
            pool.address,
            user.address,
            minTick + tickDistance,
            maxTick - tickDistance,
            ticksPrevious,
            exceedingLiquidity.sub(ONE),
            '0x'
          )
        ).to.not.be.reverted;
      });

      it('should fail for 0 qty', async () => {
        await expect(callback.mint(pool.address, user.address, 0, 100, ticksPrevious, 0, '0x')).to.be.revertedWith(
          '0 qty'
        );
      });

      it('should fail if insufficient tokens are sent for minting', async () => {
        await expect(
          callback.badMint(pool.address, user.address, minTick, maxTick, ticksPrevious, MIN_LIQUIDITY, true, false)
        ).to.be.revertedWith('lacking qty0');

        await expect(
          callback.badMint(pool.address, user.address, minTick, maxTick, ticksPrevious, MIN_LIQUIDITY, false, true)
        ).to.be.revertedWith('lacking qty1');
      });

      describe('successful mints', async () => {
        beforeEach('fetch initial token balances of pool and user, and current tick', async () => {
          poolBalToken0 = await token0.balanceOf(pool.address);
          poolBalToken1 = await token1.balanceOf(pool.address);
          initialPrice = (await pool.getPoolState()).sqrtP;
        });
        describe('position above current tick', async () => {
          beforeEach('reset position data', async () => {
            nearestTickToPrice = (await getNearestSpacedTickAtPrice(initialPrice, tickDistance)).toNumber();
            tickLower = nearestTickToPrice + tickDistance;
            tickUpper = nearestTickToPrice + 5 * tickDistance;
            tickLowerData = await pool.ticks(tickLower);
            tickUpperData = await pool.ticks(tickUpper);
          });

          it('should only transfer token0', async () => {
            await expect(
              callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, MIN_LIQUIDITY, '0x')
            )
              .to.emit(token0, 'Transfer')
              .to.not.emit(token1, 'Transfer');
            expect(await token0.balanceOf(pool.address)).to.be.gt(poolBalToken0);
            expect(await token1.balanceOf(pool.address)).to.be.eql(poolBalToken1);
          });

          it('should take larger token0 qty for larger liquidity', async () => {
            await callback.mint(
              pool.address,
              user.address,
              tickLower,
              tickUpper,
              ticksPrevious,
              PRECISION.div(MIN_LIQUIDITY),
              '0x'
            );
            let token0Taken = (await token0.balanceOf(pool.address)).sub(poolBalToken0);
            poolBalToken0 = await token0.balanceOf(pool.address);
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            expect((await token0.balanceOf(pool.address)).sub(poolBalToken0)).to.be.gt(token0Taken);
          });

          it('should mint for extreme max position', async () => {
            let maxLiquidityGross = await pool.maxTickLiquidity();
            await callback.mint(
              pool.address,
              user.address,
              maxTick - tickDistance,
              maxTick,
              ticksPrevious,
              maxLiquidityGross.sub(MIN_LIQUIDITY.mul(TWO)),
              '0x'
            );
            expect(await token0.balanceOf(pool.address)).to.be.gt(poolBalToken0);
            expect(await token1.balanceOf(pool.address)).to.be.eql(poolBalToken1);
          });

          it('should have incremented user position liquidity and unchanged feeGrowthInsideLast', async () => {
            positionData = await pool.getPositions(user.address, tickLower, tickUpper);
            expect(positionData.liquidity).to.be.eql(ZERO);
            // no swap, no fees
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            positionData = await pool.getPositions(user.address, tickLower, tickUpper);
            expect(positionData.liquidity).to.be.eql(PRECISION);
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
          });

          it('should not increment pool liquidity', async () => {
            let poolLiquidityBefore = (await pool.getLiquidityState()).baseL;
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            expect((await pool.getLiquidityState()).baseL).to.be.eql(poolLiquidityBefore);
          });

          it('should correctly adjust tickLower and tickUpper data', async () => {
            // liquidityGross
            expect(tickLowerData.liquidityGross).to.be.eql(ZERO);
            expect(tickUpperData.liquidityGross).to.be.eql(ZERO);
            // feeGrowthOutside
            expect(tickLowerData.feeGrowthOutside).to.be.eql(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.eql(ZERO);
            // secondsPerLiquidityOutside
            expect(tickLowerData.secondsPerLiquidityOutside).to.be.eql(ZERO);
            expect(tickUpperData.secondsPerLiquidityOutside).to.be.eql(ZERO);

            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');

            tickLowerData = await pool.ticks(tickLower);
            tickUpperData = await pool.ticks(tickUpper);

            // liquidityGross
            expect(tickLowerData.liquidityGross).to.be.eql(PRECISION);
            expect(tickUpperData.liquidityGross).to.be.eql(PRECISION);
            // feeGrowthOutside
            expect(tickLowerData.feeGrowthOutside).to.be.eql(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.eql(ZERO);
            // secondsPerLiquidityOutside
            expect(tickLowerData.secondsPerLiquidityOutside).to.be.eql(ZERO);
            expect(tickUpperData.secondsPerLiquidityOutside).to.be.eql(ZERO);
          });

          it('should not have updated time data if initial pool liquidity is zero', async () => {
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');

            expect(await pool.secondsPerLiquidityGlobal()).to.be.eq(ZERO);
            expect(await pool.secondsPerLiquidityUpdateTime()).to.be.eq(ZERO);
          });

          it('should update time data if initial pool liquidity is non-zero', async () => {
            // mint a position within current price
            // so that pool liquidity becomes non-zero
            await callback.mint(
              pool.address,
              user.address,
              nearestTickToPrice - 5 * tickDistance,
              nearestTickToPrice + 5 * tickDistance,
              ticksPrevious,
              PRECISION,
              '0x'
            );
            let secondsPerLiquidityGlobalBefore = await pool.secondsPerLiquidityGlobal();
            let secondsPerLiquidityUpdateTimeBefore = await pool.secondsPerLiquidityUpdateTime();

            // mint position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');

            // should have updated
            expect(await pool.secondsPerLiquidityGlobal()).to.be.gt(secondsPerLiquidityGlobalBefore);
            expect(await pool.secondsPerLiquidityUpdateTime()).to.be.gt(secondsPerLiquidityUpdateTimeBefore);
          });

          it('should not change initialized ticks status for liquidity addition', async () => {
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            // add liquidity
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');

            tickLowerData = await pool.ticks(tickLower);
            tickUpperData = await pool.ticks(tickUpper);

            expect(tickLowerData.feeGrowthOutside).to.be.eql(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.eql(ZERO);
            expect(tickLowerData.secondsPerLiquidityOutside).to.be.eql(ZERO);
            expect(tickUpperData.secondsPerLiquidityOutside).to.be.eql(ZERO);
          });

          it('should add on liquidity to same position', async () => {
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            positionData = await pool.getPositions(user.address, tickLower, tickUpper);
            expect(positionData.liquidity).to.be.eql(PRECISION);
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
            // add on more liquidity
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            positionData = await pool.getPositions(user.address, tickLower, tickUpper);
            expect(positionData.liquidity).to.be.eql(PRECISION.mul(TWO));
            // no change in fees since no swap performed
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
          });

          it('should correctly update position state if adding liquidity after swap cross into position', async () => {
            // provide enough liquidity to swap to tickUpper
            await callback.mint(
              pool.address,
              user.address,
              tickLower - 5 * tickDistance,
              tickUpper + 5 * tickDistance,
              ticksPrevious,
              PRECISION.mul(BPS),
              '0x'
            );
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            positionData = await pool.getPositions(user.address, tickLower, tickUpper);
            expect(positionData.liquidity).to.be.eql(PRECISION);
            // no swap, no fees
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
            // do swaps to cross into position
            await swapToUpTick(pool, user, tickUpper);
            // add on more liquidity
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');

            positionData = await pool.getPositions(user.address, tickLower, tickUpper);
            expect(positionData.liquidity).to.be.eql(PRECISION.mul(TWO));
            // should have increased fees
            expect(positionData.feeGrowthInsideLast).to.be.gt(ZERO);
          });

          it('should have 0 secondsPerLiquidity since position is outside current tick', async () => {
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            // advance time
            await pool.forwardTime(10);
            // should return 0 secondsPerLiquidityInside
            expect(await pool.getSecondsPerLiquidityInside(tickLower, tickUpper)).to.be.eql(ZERO);
          });

          it('should correctly update secondsPerLiquidity if swap cross into and out of position', async () => {
            // provide enough liquidity to swap to tickUpper
            await callback.mint(
              pool.address,
              user.address,
              tickLower - 5 * tickDistance,
              tickUpper + 5 * tickDistance,
              ticksPrevious,
              PRECISION.mul(BPS),
              '0x'
            );
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');

            // do swaps to cross into, but stay in position
            await swapToUpTick(pool, user, tickUpper - 1);

            // secondsPerLiquidityInside
            // should have non-zero secondsPerLiquidityInside
            // since price is now in range of position
            await pool.forwardTime(10);
            let secondsPerLiquidityInside = await pool.getSecondsPerLiquidityInside(tickLower, tickUpper);
            expect(secondsPerLiquidityInside).to.be.gt(ZERO);
            // increment time again, secondsPerLiquidityInside should further increase
            // but because of potential underflow, we test for non-equality
            await pool.forwardTime(10);
            expect(await pool.getSecondsPerLiquidityInside(tickLower, tickUpper)).to.not.be.eq(
              secondsPerLiquidityInside
            );

            // cross outside position
            await swapToUpTick(pool, user, tickUpper + 1);
            secondsPerLiquidityInside = await pool.getSecondsPerLiquidityInside(tickLower, tickUpper);
            // increment time, secondsPerLiquidityInside should remain the same
            await pool.forwardTime(10);
            expect(await pool.getSecondsPerLiquidityInside(tickLower, tickUpper)).to.be.eql(secondsPerLiquidityInside);
          });

          it('#gas [ @skip-on-coverage ]', async () => {
            // provide enough liquidity to swap to tickUpper
            let _ticksPrevious = await getTicksPrevious(
              pool,
              tickLower - 5 * tickDistance,
              tickUpper + 5 * tickDistance
            );
            await callback.mint(
              pool.address,
              user.address,
              tickLower - 5 * tickDistance,
              tickUpper + 5 * tickDistance,
              _ticksPrevious,
              PRECISION.mul(BPS),
              '0x'
            );
            // mint new position
            _ticksPrevious = await getTicksPrevious(pool, tickLower, tickUpper);
            let tx = await callback.mint(
              pool.address,
              user.address,
              tickLower,
              tickUpper,
              _ticksPrevious,
              PRECISION,
              '0x'
            );
            await snapshotGasCost(tx);
            // do swaps to cross into position
            await swapToUpTick(pool, user, tickUpper);
            // add on more liquidity
            _ticksPrevious = await getTicksPrevious(pool, tickLower, tickUpper);
            tx = await callback.mint(
              pool.address,
              user.address,
              tickLower,
              tickUpper,
              _ticksPrevious,
              PRECISION,
              '0x'
            );
            await snapshotGasCost(tx);
          });
        });

        describe('position includes current tick', async () => {
          beforeEach('reset position data', async () => {
            nearestTickToPrice = (await getNearestSpacedTickAtPrice(initialPrice, tickDistance)).toNumber();
            tickLower = nearestTickToPrice - 2 * tickDistance;
            tickUpper = nearestTickToPrice + 2 * tickDistance;
            tickLowerData = await pool.ticks(tickLower);
            tickUpperData = await pool.ticks(tickUpper);
          });

          it('should transfer both token0 and token1', async () => {
            await expect(
              callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, MIN_LIQUIDITY, '0x')
            )
              .to.emit(token0, 'Transfer')
              .to.emit(token1, 'Transfer');
            expect(await token0.balanceOf(pool.address)).to.be.gt(poolBalToken0);
            expect(await token1.balanceOf(pool.address)).to.be.gt(poolBalToken1);
          });

          it('should take larger token0 and token1 qtys for larger liquidity', async () => {
            await callback.mint(
              pool.address,
              user.address,
              tickLower,
              tickUpper,
              ticksPrevious,
              PRECISION.div(MIN_LIQUIDITY),
              '0x'
            );
            let token0Taken = (await token0.balanceOf(pool.address)).sub(poolBalToken0);
            let token1Taken = (await token1.balanceOf(pool.address)).sub(poolBalToken1);
            poolBalToken0 = await token0.balanceOf(pool.address);
            poolBalToken1 = await token1.balanceOf(pool.address);
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            expect((await token0.balanceOf(pool.address)).sub(poolBalToken0)).to.be.gt(token0Taken);
            expect((await token1.balanceOf(pool.address)).sub(poolBalToken1)).to.be.gt(token1Taken);
          });

          it('should mint for extreme position', async () => {
            let maxLiquidityGross = await pool.maxTickLiquidity();
            await callback.mint(
              pool.address,
              user.address,
              minTick,
              minTick + tickDistance,
              ticksPrevious,
              maxLiquidityGross.sub(MIN_LIQUIDITY.mul(TWO)),
              '0x'
            );
            expect(await token0.balanceOf(pool.address)).to.be.eql(poolBalToken0);
            expect(await token1.balanceOf(pool.address)).to.be.gt(poolBalToken1);
          });

          it('should have incremented user position liquidity and unchanged feeGrowthInsideLast', async () => {
            positionData = await pool.getPositions(user.address, tickLower, tickUpper);
            expect(positionData.liquidity).to.be.eql(ZERO);
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            positionData = await pool.getPositions(user.address, tickLower, tickUpper);
            expect(positionData.liquidity).to.be.eql(PRECISION);
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
          });

          it('should have incremented pool liquidity', async () => {
            let beforeBaseL = (await pool.getLiquidityState()).baseL;
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            expect((await pool.getLiquidityState()).baseL).to.be.eql(beforeBaseL.add(PRECISION));
          });

          it('should correctly adjust tickLower and tickUpper data', async () => {
            // liquidityGross
            expect(tickLowerData.liquidityGross).to.be.eql(ZERO);
            expect(tickUpperData.liquidityGross).to.be.eql(ZERO);
            // feeGrowthOutside
            expect(tickLowerData.feeGrowthOutside).to.be.eql(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.eql(ZERO);
            // secondsPerLiquidityOutside
            expect(tickLowerData.secondsPerLiquidityOutside).to.be.eql(ZERO);
            expect(tickUpperData.secondsPerLiquidityOutside).to.be.eql(ZERO);

            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');

            tickLowerData = await pool.ticks(tickLower);
            tickUpperData = await pool.ticks(tickUpper);

            // liquidityGross
            expect(tickLowerData.liquidityGross).to.be.eql(PRECISION);
            expect(tickUpperData.liquidityGross).to.be.eql(PRECISION);
            // feeGrowthOutside
            expect(tickLowerData.feeGrowthOutside).to.be.eql(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.eql(ZERO);
            // secondsPerLiquidityOutside
            expect(tickLowerData.secondsPerLiquidityOutside).to.be.eql(ZERO);
            expect(tickUpperData.secondsPerLiquidityOutside).to.be.eql(ZERO);
          });

          it('should have correctly updated time data', async () => {
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');

            // pool liquidity before update is zero, so no update occurs
            expect(await pool.secondsPerLiquidityGlobal()).to.be.eq(ZERO);
            expect(await pool.secondsPerLiquidityUpdateTime()).to.be.eq(ZERO);

            // mint again
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');

            // pool liquidity before update is non-zero, should have updated
            expect(await pool.secondsPerLiquidityGlobal()).to.be.gt(ZERO);
            expect(await pool.secondsPerLiquidityUpdateTime()).to.be.gt(ZERO);
          });

          it('should instantiate tick lower feeGrowthOutside and secondsPerLiquidityOutside for mint', async () => {
            // feeGrowthOutside
            expect(tickLowerData.feeGrowthOutside).to.be.eql(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.eql(ZERO);
            // secondsPerLiquidityOutside
            expect(tickLowerData.secondsPerLiquidityOutside).to.be.eql(ZERO);
            expect(tickUpperData.secondsPerLiquidityOutside).to.be.eql(ZERO);

            // provide enough liquidity so that lc collected > 0 when swapping
            await callback.mint(
              pool.address,
              user.address,
              nearestTickToPrice - 100 * tickDistance,
              nearestTickToPrice + 100 * tickDistance,
              ticksPrevious,
              PRECISION,
              '0x'
            );
            // swap to initialized tick to increment secondsPerLiquidity
            await swapToUpTick(pool, user, nearestTickToPrice + 100 * tickDistance);
            await swapToDownTick(pool, user, nearestTickToPrice);

            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');

            tickLowerData = await pool.ticks(tickLower);
            tickUpperData = await pool.ticks(tickUpper);

            // feeGrowthOutside
            expect(tickLowerData.feeGrowthOutside).to.be.gt(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.eql(ZERO);
            // secondsPerLiquidityOutside
            expect(tickLowerData.secondsPerLiquidityOutside).to.be.gt(ZERO);
            expect(tickUpperData.secondsPerLiquidityOutside).to.be.eql(ZERO);
          });

          it('should not change initialized ticks status for liquidity addition', async () => {
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            // add liquidity
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');

            tickLowerData = await pool.ticks(tickLower);
            tickUpperData = await pool.ticks(tickUpper);

            expect(tickLowerData.feeGrowthOutside).to.be.eql(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.eql(ZERO);
            expect(tickLowerData.secondsPerLiquidityOutside).to.be.eql(ZERO);
            expect(tickUpperData.secondsPerLiquidityOutside).to.be.eql(ZERO);
          });

          it('should add on liquidity to same position', async () => {
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            positionData = await pool.getPositions(user.address, tickLower, tickUpper);
            expect(positionData.liquidity).to.be.eql(PRECISION);
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
            // add on more liquidity
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            positionData = await pool.getPositions(user.address, tickLower, tickUpper);
            expect(positionData.liquidity).to.be.eql(PRECISION.mul(TWO));
            // no change in fees since no swap performed
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
          });

          it('should correctly update position state if adding liquidity after swap cross into position', async () => {
            // provide enough liquidity to swap to tickUpper
            await callback.mint(
              pool.address,
              user.address,
              tickLower - 5 * tickDistance,
              tickUpper + 5 * tickDistance,
              ticksPrevious,
              PRECISION.mul(BPS),
              '0x'
            );
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            positionData = await pool.getPositions(user.address, tickLower, tickUpper);
            expect(positionData.liquidity).to.be.eql(PRECISION);
            // no swap, no fees
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
            // do a few swaps, since price is in position, direction doesnt matter
            await doRandomSwaps(pool, user, 3);
            // add on more liquidity
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');

            positionData = await pool.getPositions(user.address, tickLower, tickUpper);
            expect(positionData.liquidity).to.be.eql(PRECISION.mul(TWO));
            // should have increased fees
            expect(positionData.feeGrowthInsideLast).to.be.gt(ZERO);
          });

          it('should have non-zero secondsPerLiquidity since current tick is within position', async () => {
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            // advance time
            await pool.forwardTime(10);
            // should return non-zero secondsPerLiquidityInside
            expect(await pool.getSecondsPerLiquidityInside(tickLower, tickUpper)).to.be.gt(ZERO);
          });

          it('should correctly update secondsPerLiquidity if swap cross out and into position', async () => {
            // provide enough liquidity to swap to tickUpper
            await callback.mint(
              pool.address,
              user.address,
              tickLower - 5 * tickDistance,
              tickUpper + 5 * tickDistance,
              ticksPrevious,
              PRECISION.mul(BPS),
              '0x'
            );
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            // swap to outside position
            await swapToUpTick(pool, user, tickUpper + 1);
            // secondsPerLiquidityInside should remain constant
            let secondsPerLiquidityInside = await pool.getSecondsPerLiquidityInside(tickLower, tickUpper);
            await pool.forwardTime(10);
            expect(await pool.getSecondsPerLiquidityInside(tickLower, tickUpper)).to.be.eql(secondsPerLiquidityInside);
            secondsPerLiquidityInside = await pool.getSecondsPerLiquidityInside(tickLower, tickUpper);

            // swap back into position range
            // secondsPerLiquidityInside should increase
            // but because of potential underflow, we test for non-equality
            await swapToDownTick(pool, user, tickUpper - 5);
            await pool.forwardTime(10);
            expect(await pool.getSecondsPerLiquidityInside(tickLower, tickUpper)).to.not.be.eq(
              secondsPerLiquidityInside
            );
          });

          it('#gas [ @skip-on-coverage ]', async () => {
            // provide enough liquidity to swap to tickUpper
            await callback.mint(
              pool.address,
              user.address,
              tickLower - 5 * tickDistance,
              tickUpper + 5 * tickDistance,
              ticksPrevious,
              PRECISION.mul(BPS),
              '0x'
            );
            // mint new position
            let tx = await callback.mint(
              pool.address,
              user.address,
              tickLower,
              tickUpper,
              ticksPrevious,
              PRECISION,
              '0x'
            );
            await snapshotGasCost(tx);

            await doRandomSwaps(pool, user, 3);
            // add on more liquidity
            tx = await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            await snapshotGasCost(tx);
          });
        });

        describe('position below current tick', async () => {
          beforeEach('reset position data', async () => {
            nearestTickToPrice = (await getNearestSpacedTickAtPrice(initialPrice, tickDistance)).toNumber();
            tickLower = nearestTickToPrice - 5 * tickDistance;
            tickUpper = nearestTickToPrice - 2 * tickDistance;
            tickLowerData = await pool.ticks(tickLower);
            tickUpperData = await pool.ticks(tickUpper);
          });

          it('should only transfer token1', async () => {
            await expect(
              callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, MIN_LIQUIDITY, '0x')
            )
              .to.emit(token1, 'Transfer')
              .to.not.emit(token0, 'Transfer');
            expect(await token0.balanceOf(pool.address)).to.be.eql(poolBalToken0);
            expect(await token1.balanceOf(pool.address)).to.be.gt(poolBalToken1);
          });

          it('should take larger token1 qty for larger liquidity', async () => {
            await callback.mint(
              pool.address,
              user.address,
              tickLower,
              tickUpper,
              ticksPrevious,
              PRECISION.div(MIN_LIQUIDITY),
              '0x'
            );
            let token1Taken = (await token1.balanceOf(pool.address)).sub(poolBalToken1);
            poolBalToken1 = await token1.balanceOf(pool.address);
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            expect((await token1.balanceOf(pool.address)).sub(poolBalToken1)).to.be.gt(token1Taken);
          });

          it('should mint for extreme position', async () => {
            let maxLiquidityGross = await pool.maxTickLiquidity();
            await callback.mint(
              pool.address,
              user.address,
              minTick,
              maxTick,
              ticksPrevious,
              maxLiquidityGross.sub(MIN_LIQUIDITY.mul(TWO)),
              '0x'
            );
            expect(await token0.balanceOf(pool.address)).to.be.gt(poolBalToken0);
            expect(await token1.balanceOf(pool.address)).to.be.gt(poolBalToken1);
          });

          it('should have incremented user position liquidity and unchanged feeGrowthInsideLast', async () => {
            positionData = await pool.getPositions(user.address, tickLower, tickUpper);
            expect(positionData.liquidity).to.be.eql(ZERO);
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            positionData = await pool.getPositions(user.address, tickLower, tickUpper);
            expect(positionData.liquidity).to.be.eql(PRECISION);
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
          });

          it('should not increment pool liquidity', async () => {
            let beforeBaseL = (await pool.getLiquidityState()).baseL;
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            expect((await pool.getLiquidityState()).baseL).to.be.eql(beforeBaseL);
          });

          it('should correctly adjust tickLower and tickUpper data', async () => {
            // liquidityGross
            expect(tickLowerData.liquidityGross).to.be.eql(ZERO);
            expect(tickUpperData.liquidityGross).to.be.eql(ZERO);
            // feeGrowthOutside
            expect(tickLowerData.feeGrowthOutside).to.be.eql(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.eql(ZERO);
            // secondsPerLiquidityOutside
            expect(tickLowerData.secondsPerLiquidityOutside).to.be.eql(ZERO);
            expect(tickUpperData.secondsPerLiquidityOutside).to.be.eql(ZERO);

            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');

            tickLowerData = await pool.ticks(tickLower);
            tickUpperData = await pool.ticks(tickUpper);

            // liquidityGross
            expect(tickLowerData.liquidityGross).to.be.eql(PRECISION);
            expect(tickUpperData.liquidityGross).to.be.eql(PRECISION);
            // feeGrowthOutside
            expect(tickLowerData.feeGrowthOutside).to.be.eql(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.eql(ZERO);
            // secondsPerLiquidityOutside
            expect(tickLowerData.secondsPerLiquidityOutside).to.be.eql(ZERO);
            expect(tickUpperData.secondsPerLiquidityOutside).to.be.eql(ZERO);
          });

          it('should not have updated time data if initial pool liquidity is zero', async () => {
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');

            expect(await pool.secondsPerLiquidityGlobal()).to.be.eq(ZERO);
            expect(await pool.secondsPerLiquidityUpdateTime()).to.be.eq(ZERO);
          });

          it('should update time data if initial pool liquidity is non-zero', async () => {
            // mint a position within current price
            // so that pool liquidity becomes non-zero
            await callback.mint(
              pool.address,
              user.address,
              nearestTickToPrice - 5 * tickDistance,
              nearestTickToPrice + 5 * tickDistance,
              ticksPrevious,
              PRECISION,
              '0x'
            );
            let secondsPerLiquidityGlobalBefore = await pool.secondsPerLiquidityGlobal();
            let secondsPerLiquidityUpdateTimeBefore = await pool.secondsPerLiquidityUpdateTime();

            // mint position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');

            // should have updated
            expect(await pool.secondsPerLiquidityGlobal()).to.be.gt(secondsPerLiquidityGlobalBefore);
            expect(await pool.secondsPerLiquidityUpdateTime()).to.be.gt(secondsPerLiquidityUpdateTimeBefore);
          });

          it('should instantiate both tick lower and tick upper feeGrowthOutside and secondsPerLiquidityOutside for mint', async () => {
            // feeGrowthOutside
            expect(tickLowerData.feeGrowthOutside).to.be.eql(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.eql(ZERO);
            // secondsPerLiquidityOutside
            expect(tickLowerData.secondsPerLiquidityOutside).to.be.eql(ZERO);
            expect(tickUpperData.secondsPerLiquidityOutside).to.be.eql(ZERO);

            // provide enough liquidity so that lc collected > 0 when swapping
            await callback.mint(
              pool.address,
              user.address,
              nearestTickToPrice - 100 * tickDistance,
              nearestTickToPrice + 100 * tickDistance,
              ticksPrevious,
              PRECISION,
              '0x'
            );
            // swap to initialized tick to increment secondsPerLiquidity
            await swapToDownTick(pool, user, nearestTickToPrice - 100 * tickDistance - 1);
            await swapToUpTick(pool, user, nearestTickToPrice);

            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');

            tickLowerData = await pool.ticks(tickLower);
            tickUpperData = await pool.ticks(tickUpper);

            // feeGrowthOutside
            expect(tickLowerData.feeGrowthOutside).to.be.gt(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.gt(ZERO);
            // secondsPerLiquidityOutside
            expect(tickLowerData.secondsPerLiquidityOutside).to.be.gt(ZERO);
            expect(tickUpperData.secondsPerLiquidityOutside).to.be.gt(ZERO);
          });

          it('should not change initialized ticks status for liquidity addition', async () => {
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            // add liquidity
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');

            tickLowerData = await pool.ticks(tickLower);
            tickUpperData = await pool.ticks(tickUpper);

            expect(tickLowerData.feeGrowthOutside).to.be.eql(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.eql(ZERO);
            expect(tickLowerData.secondsPerLiquidityOutside).to.be.eql(ZERO);
            expect(tickUpperData.secondsPerLiquidityOutside).to.be.eql(ZERO);
          });

          it('should add on liquidity to same position', async () => {
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            positionData = await pool.getPositions(user.address, tickLower, tickUpper);
            expect(positionData.liquidity).to.be.eql(PRECISION);
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
            // add on more liquidity
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            positionData = await pool.getPositions(user.address, tickLower, tickUpper);
            expect(positionData.liquidity).to.be.eql(PRECISION.mul(TWO));
            // no change in fees since no swap performed
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
          });

          it('should correctly update position state if adding liquidity after swap cross into position', async () => {
            // provide enough liquidity to swap to tickUpper
            await callback.mint(
              pool.address,
              user.address,
              tickLower - 5 * tickDistance,
              tickUpper + 5 * tickDistance,
              ticksPrevious,
              PRECISION.mul(BPS),
              '0x'
            );
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            positionData = await pool.getPositions(user.address, tickLower, tickUpper);
            expect(positionData.liquidity).to.be.eql(PRECISION);
            // no swap, no fees
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
            // swap to cross into position
            await swapToDownTick(pool, user, tickLower);
            // add on more liquidity
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            positionData = await pool.getPositions(user.address, tickLower, tickUpper);
            expect(positionData.liquidity).to.be.eql(PRECISION.mul(TWO));
            // should have increased fees
            expect(positionData.feeGrowthInsideLast).to.be.gt(ZERO);
          });

          it('should have 0 secondsPerLiquidity since position is outside current tick', async () => {
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            // advance time
            await pool.forwardTime(10);
            // should return 0 secondsPerLiquidityInside
            expect(await pool.getSecondsPerLiquidityInside(tickLower, tickUpper)).to.be.eql(ZERO);
          });

          it('should correctly update secondsPerLiquidity if swap cross into and out of position', async () => {
            // provide enough liquidity to swap to tickUpper
            await callback.mint(
              pool.address,
              user.address,
              tickLower - 5 * tickDistance,
              tickUpper + 5 * tickDistance,
              ticksPrevious,
              PRECISION.mul(BPS),
              '0x'
            );
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');

            // do swaps to cross into position
            await swapToDownTick(pool, user, tickUpper - 1);

            // secondsPerLiquidityInside
            // should have non-zero secondsPerLiquidityInside
            // since price is now in range of position
            await pool.forwardTime(10);
            let secondsPerLiquidityInside = await pool.getSecondsPerLiquidityInside(tickLower, tickUpper);
            expect(secondsPerLiquidityInside).to.be.gt(ZERO);
            // increment time again, secondsPerLiquidityInside should further increase
            // but because of potential underflow, we test for non-equality
            await pool.forwardTime(10);
            expect(await pool.getSecondsPerLiquidityInside(tickLower, tickUpper)).to.not.be.eq(
              secondsPerLiquidityInside
            );

            // cross outside position
            await swapToUpTick(pool, user, tickUpper + 1);
            secondsPerLiquidityInside = await pool.getSecondsPerLiquidityInside(tickLower, tickUpper);
            // increment time, secondsPerLiquidityInside should remain the same
            await pool.forwardTime(10);
            expect(await pool.getSecondsPerLiquidityInside(tickLower, tickUpper)).to.be.eql(secondsPerLiquidityInside);
          });
        });

        describe('overlapping positions', async () => {
          it('should have 0 liquidityNet but liquidity gross != 0 if tickUpper of 1 position == tickLower of another', async () => {
            nearestTickToPrice = (await getNearestSpacedTickAtPrice(initialPrice, tickDistance)).toNumber();
            tickLower = nearestTickToPrice - tickDistance;
            tickUpper = nearestTickToPrice + tickDistance;
            // mint lower position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            tickLower = tickUpper;
            tickUpper = tickUpper + tickDistance;
            // mint upper position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
            // check overlapping tick data
            let tickData = await pool.ticks(tickLower);
            expect(tickData.liquidityGross).to.not.eql(ZERO);
            expect(tickData.liquidityNet).to.eql(ZERO);
          });
        });
      });
    });
  });

  describe('#burn', async () => {
    it('should fail if pool is not unlocked', async () => {
      await expect(pool.burn(0, 100, PRECISION)).to.be.revertedWith('locked');
    });

    describe('after unlockPool', async () => {
      beforeEach('unlock pool with initial price of 2:1, mint 1 position, and perform necessary setup', async () => {
        initialPrice = encodePriceSqrt(TWO, ONE);
        nearestTickToPrice = (await getNearestSpacedTickAtPrice(initialPrice, tickDistance)).toNumber();
        // mint 1 position
        tickLower = nearestTickToPrice - 100 * tickDistance;
        tickUpper = nearestTickToPrice + 100 * tickDistance;
        await callback.unlockPool(pool.address, initialPrice, '0x');
        // whitelist callback for minting position
        await factory.connect(admin).addNFTManager(callback.address);
        await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION.mul(BPS), '0x');
      });

      it('should fail burning liquidity if user has no position', async () => {
        await expect(pool.connect(configMaster).burn(tickLower, tickUpper, ONE)).to.be.reverted;
      });

      it('should fail burning more than position liquidity', async () => {
        await expect(pool.connect(user).burn(tickLower, tickUpper, PRECISION.mul(BPS).add(ONE))).to.be.reverted;
      });

      it('should fail with zero qty', async () => {
        await expect(pool.connect(user).burn(tickLower, tickUpper, ZERO)).to.be.revertedWith('0 qty');
      });

      it('should burn liquidity with event emission', async () => {
        // note that user need not be whitelisted as burn() is not restricted
        await expect(pool.connect(user).burn(tickLower, tickUpper, PRECISION.mul(BPS))).to.emit(pool, 'Burn');
        const {liquidity} = await pool.getPositions(user.address, tickLower, tickUpper);
        expect(liquidity).to.be.eql(ZERO);
      });

      it('should retain fee growth position snapshot after all user liquidity is removed', async () => {
        // swap to outside user position to update feeGrowthGlobal
        await swapToUpTick(pool, user, tickUpper + 1);
        await pool.connect(user).burn(tickLower, tickUpper, PRECISION.mul(BPS));
        let position = await pool.getPositions(user.address, tickLower, tickUpper);
        expect(position.liquidity).to.be.eql(ZERO);
        expect(position.feeGrowthInsideLast).to.be.gt(ZERO);
      });

      it('should clear the tick if last position containing it is cleared', async () => {
        await callback.mint(
          pool.address,
          user.address,
          tickLower + tickDistance,
          tickUpper - tickDistance,
          ticksPrevious,
          PRECISION,
          '0x'
        );
        await doRandomSwaps(pool, user, 3);
        await pool.connect(user).burn(tickLower + tickDistance, tickUpper - tickDistance, PRECISION);
        expect(await isTickCleared(tickLower + tickDistance)).to.be.true;
        expect(await isTickCleared(tickUpper - tickDistance)).to.be.true;
      });

      it('should clear only lower tick if upper remains used', async () => {
        await callback.mint(
          pool.address,
          user.address,
          tickLower + tickDistance,
          tickUpper,
          ticksPrevious,
          PRECISION,
          '0x'
        );
        await doRandomSwaps(pool, user, 3);
        await pool.connect(user).burn(tickLower + tickDistance, tickUpper, PRECISION);
        expect(await isTickCleared(tickLower + tickDistance)).to.be.true;
        expect(await isTickCleared(tickUpper)).to.be.false;
      });

      it('should clear only upper tick if lower remains used', async () => {
        await callback.mint(
          pool.address,
          user.address,
          tickLower,
          tickUpper - tickDistance,
          ticksPrevious,
          PRECISION,
          '0x'
        );
        await doRandomSwaps(pool, user, 3);
        await pool.connect(user).burn(tickLower, tickUpper - tickDistance, PRECISION);
        expect(await isTickCleared(tickLower)).to.be.false;
        expect(await isTickCleared(tickUpper - tickDistance)).to.be.true;
      });

      it('will not transfer rTokens to user if position is burnt without any swap', async () => {
        let userRTokenBalanceBefore = await pool.balanceOf(user.address);
        await pool.connect(user).burn(tickLower, tickUpper, PRECISION.mul(BPS));
        expect(await pool.balanceOf(user.address)).to.be.eql(userRTokenBalanceBefore);
      });

      it('should transfer rTokens to user after swaps overlapping user position crosses a tick', async () => {
        // swap to outside user position to update feeGrowthGlobal
        await swapToUpTick(pool, user, tickUpper + 1);
        let userRTokenBalanceBefore = await pool.balanceOf(user.address);
        await pool.connect(user).burn(tickLower, tickUpper, PRECISION);
        expect(await pool.balanceOf(user.address)).to.be.gt(userRTokenBalanceBefore);
      });

      it('should not transfer any rTokens if fees collected are outside position', async () => {
        tickLower = nearestTickToPrice + 10 * tickDistance;
        tickUpper = nearestTickToPrice + 20 * tickDistance;
        // mint position above current tick
        await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
        // swap to below lower tick
        await swapToDownTick(pool, user, tickLower - 5);
        let userRTokenBalanceBefore = await pool.balanceOf(user.address);
        await pool.connect(user).burn(tickLower, tickUpper, PRECISION);
        expect(await pool.balanceOf(user.address)).to.be.eq(userRTokenBalanceBefore);
      });

      it('should only transfer token0 if position burnt is above current tick', async () => {
        // push current tick to below tickLower
        await swapToDownTick(pool, user, tickLower);
        await expect(pool.connect(user).burn(tickLower, tickUpper, PRECISION))
          .to.emit(token0, 'Transfer')
          .to.not.emit(token1, 'Transfer');
      });

      it('should transfer token0 and token1 if current tick is within position burnt', async () => {
        // swap to tickUpper
        await swapToUpTick(pool, user, tickUpper);
        // push current tick to slightly above tickLower
        await swapToDownTick(pool, user, tickLower + 10);
        await expect(pool.connect(user).burn(tickLower, tickUpper, PRECISION))
          .to.emit(token1, 'Transfer')
          .to.emit(token0, 'Transfer');
      });

      it('should only transfer token1 if position burnt is below current tick', async () => {
        // push current tick to above tickUpper
        await swapToUpTick(pool, user, tickUpper);
        await expect(pool.connect(user).burn(tickLower, tickUpper, PRECISION))
          .to.emit(token1, 'Transfer')
          .to.not.emit(token0, 'Transfer');
      });
    });
  });

  describe('pool liquidity updates', async () => {
    beforeEach('unlock pool at 0 tick', async () => {
      initialPrice = encodePriceSqrt(ONE, ONE);
      // whitelist callback for minting position
      await factory.connect(admin).addNFTManager(callback.address);
      await callback.unlockPool(pool.address, initialPrice, '0x');
      await callback.mint(
        pool.address,
        user.address,
        -100 * tickDistance,
        100 * tickDistance,
        ticksPrevious,
        PRECISION,
        '0x'
      );
    });

    describe('position above current price', async () => {
      it('should increase and decrease pool liquidity when entering and exiting range', async () => {
        tickLower = 10 * tickDistance;
        tickUpper = 20 * tickDistance;
        await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');

        let beforeBaseL = (await pool.getLiquidityState()).baseL;
        // enter position range
        await swapToUpTick(pool, user, tickLower);
        let afterBaseL = (await pool.getLiquidityState()).baseL;
        expect(afterBaseL).to.be.gt(beforeBaseL);
        beforeBaseL = afterBaseL;
        // exit position range
        await swapToUpTick(pool, user, tickUpper);
        expect((await pool.getLiquidityState()).baseL).to.be.lt(beforeBaseL);
      });
    });

    describe('position within current price', async () => {
      it('should increase and decrease pool liquidity when entering and exiting range', async () => {
        tickLower = -10 * tickDistance;
        tickUpper = 10 * tickDistance;
        let beforeBaseL = (await pool.getLiquidityState()).baseL;
        await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
        let afterbaseL = (await pool.getLiquidityState()).baseL;
        expect(afterbaseL).to.be.gt(beforeBaseL);
        beforeBaseL = afterbaseL;

        // exit position range
        await swapToUpTick(pool, user, tickUpper);
        afterbaseL = (await pool.getLiquidityState()).baseL;
        expect(afterbaseL).to.be.lt(beforeBaseL);
        beforeBaseL = afterbaseL;

        // enter position range
        await swapToDownTick(pool, user, tickUpper - 1);
        afterbaseL = (await pool.getLiquidityState()).baseL;
        expect(afterbaseL).to.be.gt(beforeBaseL);
        beforeBaseL = afterbaseL;

        // exit position range (lower)
        await swapToDownTick(pool, user, tickLower);
        afterbaseL = (await pool.getLiquidityState()).baseL;
        expect(afterbaseL).to.be.lt(beforeBaseL);
        beforeBaseL = afterbaseL;

        // re-enter position range (lower)
        await swapToDownTick(pool, user, tickLower - 2);
        await swapToUpTick(pool, user, tickLower);
        afterbaseL = (await pool.getLiquidityState()).baseL;
        expect(afterbaseL).to.be.gt(beforeBaseL);
      });
    });

    describe('position below current price', async () => {
      it('should increase and decrease pool liquidity when entering and exiting range', async () => {
        tickLower = -20 * tickDistance;
        tickUpper = -10 * tickDistance;
        await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');

        let poolLiquidityBefore = (await pool.getLiquidityState()).baseL;
        // enter position range
        await swapToDownTick(pool, user, tickUpper);
        let poolLiquidityAfter = (await pool.getLiquidityState()).baseL;
        expect(poolLiquidityAfter).to.be.gt(poolLiquidityBefore);
        poolLiquidityBefore = poolLiquidityAfter;
        // exit position range
        await swapToDownTick(pool, user, tickLower);
        expect((await pool.getLiquidityState()).baseL).to.be.lt(poolLiquidityBefore);
      });
    });

    describe('turn on govt fee', async () => {
      it('should mint any outstanding rTokens and send it to feeTo', async () => {
        tickLower = -10 * tickDistance;
        tickUpper = 10 * tickDistance;

        // set non-zero and feeTo in factory
        await factory.updateFeeConfiguration(configMaster.address, 5);
        let feeToRTokenBalanceBefore = await pool.balanceOf(configMaster.address);

        // do some random swaps to accumulate fees
        await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
        // do a couple of small swaps so that lf is incremented but not lfLast
        await doRandomSwaps(pool, user, 3, BN.from(10_000_000));
        await pool.connect(user).burn(tickLower, tickUpper, PRECISION);
        // should have minted and sent rTokens to feeTo
        expect(await pool.balanceOf(configMaster.address)).to.be.gt(feeToRTokenBalanceBefore);
      });
    });
  });

  describe('limit orders', async () => {
    beforeEach('unlock pool with initial price of 1:1 (tick 0)', async () => {
      initialPrice = encodePriceSqrt(ONE, ONE);
      await callback.unlockPool(pool.address, initialPrice, '0x');
      // whitelist callback for minting position
      await factory.connect(admin).addNFTManager(callback.address);
    });

    it('should execute a position converting token0 to token1', async () => {
      // mint position above current tick
      await expect(callback.mint(pool.address, user.address, 0, 100, ticksPrevious, PRECISION, '0x'))
        .to.emit(token0, 'Transfer')
        .to.not.emit(token1, 'Transfer');

      // take limit order
      await swapToUpTick(pool, user, 101);

      // burn position, should only get token1
      await expect(pool.connect(user).burn(0, 100, PRECISION))
        .to.emit(token1, 'Transfer')
        .to.not.emit(token0, 'Transfer');
      expect((await pool.getPoolState()).currentTick).to.be.gte(100);
      expect((await pool.getPoolState()).nearestCurrentTick).to.be.eq(MIN_TICK);
    });

    it('should execute a position converting token1 to token0', async () => {
      // mint position below current tick
      await expect(callback.mint(pool.address, user.address, -100, 0, ticksPrevious, PRECISION, '0x'))
        .to.emit(token1, 'Transfer')
        .to.not.emit(token0, 'Transfer');

      // take limit order
      await swapToDownTick(pool, user, -101);

      // burn position, should only get token0
      await expect(pool.connect(user).burn(-100, 0, PRECISION))
        .to.emit(token0, 'Transfer')
        .to.not.emit(token1, 'Transfer');
      expect((await pool.getPoolState()).currentTick).to.be.lte(-100);
      expect((await pool.getPoolState()).nearestCurrentTick).to.be.eq(MIN_TICK);
    });
  });

  describe('burnRTokens', async () => {
    describe('init at 0 tick', async () => {
      beforeEach('mint rTokens for user', async () => {
        initialPrice = encodePriceSqrt(ONE, ONE);
        await callback.unlockPool(pool.address, initialPrice, '0x');
        // whitelist callback for minting position
        await factory.connect(admin).addNFTManager(callback.address);
        await callback.mint(pool.address, user.address, -100, 100, ticksPrevious, PRECISION, '0x');
        // do swaps to increment lf
        await swapToUpTick(pool, user, 50);
        await swapToDownTick(pool, user, 0);
        // burn to mint rTokens
        await pool.connect(user).burn(-100, 100, MIN_LIQUIDITY);
        expect(await pool.balanceOf(user.address)).to.be.gt(ZERO);
      });

      it('should fail if user tries to burn more rTokens than what he has', async () => {
        let userRTokenBalance = await pool.balanceOf(user.address);
        await expect(pool.connect(user).burnRTokens(userRTokenBalance.add(ONE), false)).to.be.revertedWith(
          'ERC20: burn amount exceeds balance'
        );
      });

      it('should have decremented lf and lfLast, and sent token0 and token1 to user', async () => {
        let beforeLiquidityState = await pool.getLiquidityState();
        let userRTokenBalance = await pool.balanceOf(user.address);
        let token0BalanceBefore = await token0.balanceOf(user.address);
        let token1BalanceBefore = await token1.balanceOf(user.address);
        await expect(pool.connect(user).burnRTokens(userRTokenBalance, false)).to.emit(pool, 'BurnRTokens');
        let afterLiquidityState = await pool.getLiquidityState();
        expect(afterLiquidityState.reinvestL).to.be.lt(beforeLiquidityState.reinvestL);
        expect(afterLiquidityState.reinvestLLast).to.be.lt(beforeLiquidityState.reinvestLLast);
        expect(await token0.balanceOf(user.address)).gt(token0BalanceBefore);
        expect(await token1.balanceOf(user.address)).gt(token1BalanceBefore);
      });

      it('should mint and increment pool fee growth global if rMintQty > 0', async () => {
        let userRTokenBalance = await pool.balanceOf(user.address);
        // do a couple of small swaps so that lf is incremented but not lfLast
        await doRandomSwaps(pool, user, 3, BN.from(10_000_000));
        let reinvestmentState = await pool.getLiquidityState();
        expect(reinvestmentState.reinvestL).to.be.gt(reinvestmentState.reinvestLLast);
        await expect(pool.connect(user).burnRTokens(userRTokenBalance, false)).to.emit(pool, 'Transfer');
        // TODO: fix this
        // expect((await pool.getReinvestmentState())._poolFeeGrowthGlobal).to.be.gt(
        //   reinvestmentState._poolFeeGrowthGlobal
        // );
      });

      it('should send a portion of collected fees to feeTo if rMintQty and govtFee > 0', async () => {
        // set non-zero and feeTo in factory
        await factory.updateFeeConfiguration(configMaster.address, 1000);
        let feeToRTokenBalanceBefore = await pool.balanceOf(configMaster.address);
        // swap till lf > lfLast
        let result = await pool.getLiquidityState();
        while (result.reinvestL.eq(result.reinvestLLast)) {
          await doRandomSwaps(pool, user, 1, BN.from(10_000_000));
          result = await pool.getLiquidityState();
        }
        await pool.connect(user).burnRTokens(await pool.balanceOf(user.address), false);
        // should have minted and sent rTokens to feeTo
        expect(await pool.balanceOf(configMaster.address)).to.be.gt(feeToRTokenBalanceBefore);
      });

      it('#gas [ @skip-on-coverage ]', async () => {
        let tx = await pool.connect(user).burnRTokens(await pool.balanceOf(user.address), false);
        await snapshotGasCost(tx);
      });
    });

    describe('init near price boundaries', async () => {
      it('should only send token1 to user when he burns rTokens when price is at MAX_SQRT_RATIO', async () => {
        // init price at 1e18 : 1
        initialPrice = encodePriceSqrt(PRECISION, ONE);
        await callback.unlockPool(pool.address, initialPrice, '0x');
        // whitelist callback for minting position
        await factory.connect(admin).addNFTManager(callback.address);
        nearestTickToPrice = (await getNearestSpacedTickAtPrice(initialPrice, tickDistance)).toNumber();
        tickLower = nearestTickToPrice - 1000;
        tickUpper = nearestTickToPrice + 1000;

        await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
        // do swaps to increment lf
        await swapToUpTick(pool, user, tickUpper);
        await swapToDownTick(pool, user, tickLower);
        // burn to mint rTokens
        await pool.connect(user).burn(tickLower, tickUpper, MIN_LIQUIDITY);
        expect(await pool.balanceOf(user.address)).to.be.gt(ZERO);

        // swap to max allowable tick
        await swapToUpTick(pool, user, MAX_TICK.toNumber() - 1);

        // burnRTokens
        let userRTokenBalance = await pool.balanceOf(user.address);
        await expect(pool.connect(user).burnRTokens(userRTokenBalance, false))
          .to.emit(token1, 'Transfer')
          .to.not.emit(token0, 'Transfer');
      });

      it('should only send token0 to user when he burns rTokens when price is at MIN_SQRT_RATIO', async () => {
        // init price at 1 : 1e18
        initialPrice = encodePriceSqrt(ONE, PRECISION);
        await callback.unlockPool(pool.address, initialPrice, '0x');
        // whitelist callback for minting position
        await factory.connect(admin).addNFTManager(callback.address);
        nearestTickToPrice = (await getNearestSpacedTickAtPrice(initialPrice, tickDistance)).toNumber();
        tickLower = nearestTickToPrice - 1000;
        tickUpper = nearestTickToPrice + 1000;

        await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION, '0x');
        // do swaps to increment lf
        await swapToUpTick(pool, user, tickUpper);
        await swapToDownTick(pool, user, tickLower);
        // burn to mint rTokens
        await pool.connect(user).burn(tickLower, tickUpper, MIN_LIQUIDITY);
        expect(await pool.balanceOf(user.address)).to.be.gt(ZERO);

        // swap to min allowable tick
        await swapToDownTick(pool, user, MIN_TICK.toNumber() + 1);

        // burnRTokens
        let userRTokenBalance = await pool.balanceOf(user.address);
        await expect(pool.connect(user).burnRTokens(userRTokenBalance, false))
          .to.emit(token0, 'Transfer')
          .to.not.emit(token1, 'Transfer');
      });
    });
  });

  describe('swap', async () => {
    describe('init at reasonable tick', async () => {
      beforeEach('unlock pool with initial price of 2:1', async () => {
        initialPrice = encodePriceSqrt(TWO, ONE);
        await callback.unlockPool(pool.address, initialPrice, '0x');
        // whitelist callback for minting position
        await factory.connect(admin).addNFTManager(callback.address);
        nearestTickToPrice = (await getNearestSpacedTickAtPrice(initialPrice, tickDistance)).toNumber();

        // mint 3 position to test
        await callback.mint(
          pool.address,
          user.address,
          nearestTickToPrice - 500 * tickDistance,
          nearestTickToPrice + 500 * tickDistance,
          ticksPrevious,
          PRECISION.mul(10),
          '0x'
        );
        await callback.mint(
          pool.address,
          user.address,
          nearestTickToPrice - 2 * tickDistance,
          nearestTickToPrice + 2 * tickDistance,
          ticksPrevious,
          PRECISION.mul(100),
          '0x'
        );
        await callback.mint(
          pool.address,
          user.address,
          nearestTickToPrice - 4 * tickDistance,
          nearestTickToPrice + 4 * tickDistance,
          ticksPrevious,
          PRECISION.mul(100),
          '0x'
        );
      });

      it('should fail for 0 swap qty', async () => {
        await expect(
          callback.swap(pool.address, user.address, ZERO, true, MIN_SQRT_RATIO.add(ONE), '0x')
        ).to.be.revertedWith('0 swapQty');
      });

      it('should fail for bad sqrt limits', async () => {
        // upTick: sqrtLimit < sqrtP
        await expect(
          callback.swap(pool.address, user.address, PRECISION, false, initialPrice.sub(ONE), '0x')
        ).to.be.revertedWith('bad limitSqrtP');
        // upTick: sqrtLimit = MAX_SQRT_RATIO
        await expect(
          callback.swap(pool.address, user.address, PRECISION, false, MAX_SQRT_RATIO, '0x')
        ).to.be.revertedWith('bad limitSqrtP');
        // downTick: sqrtLimit > sqrtP
        await expect(
          callback.swap(pool.address, user.address, PRECISION, true, initialPrice.add(ONE), '0x')
        ).to.be.revertedWith('bad limitSqrtP');
        // downTick: sqrtLimit = MIN_SQRT_RATIO
        await expect(
          callback.swap(pool.address, user.address, PRECISION, true, MIN_SQRT_RATIO, '0x')
        ).to.be.revertedWith('bad limitSqrtP');
      });

      it('tests token0 exactInput (move down tick)', async () => {
        tickLower = nearestTickToPrice - 500 * tickDistance;
        tickUpper = nearestTickToPrice + 2 * tickDistance;
        await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION.mul(10), '0x');
        let token0BalanceBefore = await token0.balanceOf(user.address);
        let token1BalanceBefore = await token1.balanceOf(user.address);
        await logSwapState(SwapTitle.BEFORE_SWAP, pool);
        await callback.swap(pool.address, user.address, PRECISION, true, MIN_SQRT_RATIO.add(ONE), '0x');
        let token0BalanceAfter = await token0.balanceOf(user.address);
        let token1BalanceAfter = await token1.balanceOf(user.address);
        await logSwapState(SwapTitle.AFTER_SWAP, pool);
        logBalanceChange(token0BalanceAfter.sub(token0BalanceBefore), token1BalanceAfter.sub(token1BalanceBefore));
      });

      it('#gas token0 exactInput - within a tick [ @skip-on-coverage ]', async () => {
        let priceLimit = await getPriceFromTick(nearestTickToPrice - tickDistance);
        priceLimit = priceLimit.add(1);

        let quoteResult = await quoter.callStatic.quoteExactInputSingle({
          tokenIn: token0.address,
          tokenOut: token1.address,
          amountIn: PRECISION.mul(PRECISION),
          feeBps: swapFeeBps,
          limitSqrtP: priceLimit
        });
        await snapshotGasCost(
          await callback.swap(pool.address, user.address, quoteResult.usedAmount, true, MIN_SQRT_RATIO.add(ONE), '0x')
        );
      });

      it('#gas token0 exactInput - cross an initiated tick [ @skip-on-coverage ]', async () => {
        let priceLimit = await getPriceFromTick(nearestTickToPrice - 3 * tickDistance);
        priceLimit = priceLimit.add(1);

        let quoteResult = await quoter.callStatic.quoteExactInputSingle({
          tokenIn: token0.address,
          tokenOut: token1.address,
          amountIn: PRECISION.mul(PRECISION),
          feeBps: swapFeeBps,
          limitSqrtP: priceLimit
        });

        await snapshotGasCost(
          await callback.swap(pool.address, user.address, quoteResult.usedAmount, true, MIN_SQRT_RATIO.add(ONE), '0x')
        );
      });

      it('#gas token0 exactInput - cross 2 initiated ticks [ @skip-on-coverage ]', async () => {
        let priceLimit = await getPriceFromTick(nearestTickToPrice - 5 * tickDistance);
        priceLimit = priceLimit.add(1);

        let quoteResult = await quoter.callStatic.quoteExactInputSingle({
          tokenIn: token0.address,
          tokenOut: token1.address,
          amountIn: PRECISION.mul(PRECISION),
          feeBps: swapFeeBps,
          limitSqrtP: priceLimit
        });

        await snapshotGasCost(
          await callback.swap(pool.address, user.address, quoteResult.usedAmount, true, MIN_SQRT_RATIO.add(ONE), '0x')
        );
      });

      it('tests token1 exactOutput (move down tick)', async () => {
        tickLower = nearestTickToPrice - 500 * tickDistance;
        tickUpper = nearestTickToPrice + 2 * tickDistance;
        await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION.mul(10), '0x');
        let token0BalanceBefore = await token0.balanceOf(user.address);
        let token1BalanceBefore = await token1.balanceOf(user.address);
        await logSwapState(SwapTitle.BEFORE_SWAP, pool);
        await callback.swap(
          pool.address,
          user.address,
          BN.from('-1751372543351715880'),
          false,
          MIN_SQRT_RATIO.add(ONE),
          '0x'
        );
        let token0BalanceAfter = await token0.balanceOf(user.address);
        let token1BalanceAfter = await token1.balanceOf(user.address);
        await logSwapState(SwapTitle.AFTER_SWAP, pool);
        logBalanceChange(token0BalanceAfter.sub(token0BalanceBefore), token1BalanceAfter.sub(token1BalanceBefore));
      });

      it('#gas token1 exactOutput - within a tick [ @skip-on-coverage ]', async () => {
        let priceLimit = await getPriceFromTick(nearestTickToPrice - tickDistance);
        priceLimit = priceLimit.add(1);

        let quoteResult = await quoter.callStatic.quoteExactOutputSingle({
          tokenIn: token0.address,
          tokenOut: token1.address,
          amount: PRECISION.mul(PRECISION),
          feeBps: swapFeeBps,
          limitSqrtP: priceLimit
        });

        await snapshotGasCost(
          await callback.swap(
            pool.address,
            user.address,
            quoteResult.usedAmount.mul(NEGATIVE_ONE),
            false,
            MIN_SQRT_RATIO.add(ONE),
            '0x'
          )
        );
      });

      it('#gas token1 exactOutput - cross an initiated tick [ @skip-on-coverage ]', async () => {
        let priceLimit = await getPriceFromTick(nearestTickToPrice - 3 * tickDistance);
        priceLimit = priceLimit.add(1);

        let quoteResult = await quoter.callStatic.quoteExactOutputSingle({
          tokenIn: token0.address,
          tokenOut: token1.address,
          amount: PRECISION.mul(PRECISION),
          feeBps: swapFeeBps,
          limitSqrtP: priceLimit
        });

        await snapshotGasCost(
          await callback.swap(
            pool.address,
            user.address,
            quoteResult.usedAmount.mul(NEGATIVE_ONE),
            false,
            MIN_SQRT_RATIO.add(ONE),
            '0x'
          )
        );
      });

      it('#gas token1 exactOutput - cross 2 initiated ticks [ @skip-on-coverage ]', async () => {
        let priceLimit = await getPriceFromTick(nearestTickToPrice - 5 * tickDistance);
        priceLimit = priceLimit.add(1);

        let quoteResult = await quoter.callStatic.quoteExactOutputSingle({
          tokenIn: token0.address,
          tokenOut: token1.address,
          amount: PRECISION.mul(PRECISION),
          feeBps: swapFeeBps,
          limitSqrtP: priceLimit
        });

        await snapshotGasCost(
          await callback.swap(
            pool.address,
            user.address,
            quoteResult.usedAmount.mul(NEGATIVE_ONE),
            false,
            MIN_SQRT_RATIO.add(ONE),
            '0x'
          )
        );
      });

      it('tests token1 exactInput (move up tick)', async () => {
        tickLower = nearestTickToPrice - 2 * tickDistance;
        tickUpper = nearestTickToPrice + 500 * tickDistance;
        await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION.mul(10), '0x');
        let token0BalanceBefore = await token0.balanceOf(user.address);
        let token1BalanceBefore = await token1.balanceOf(user.address);
        await logSwapState(SwapTitle.BEFORE_SWAP, pool);
        await callback.swap(pool.address, user.address, PRECISION, false, MAX_SQRT_RATIO.sub(ONE), '0x');
        let token0BalanceAfter = await token0.balanceOf(user.address);
        let token1BalanceAfter = await token1.balanceOf(user.address);
        await logSwapState(SwapTitle.AFTER_SWAP, pool);
        logBalanceChange(token0BalanceAfter.sub(token0BalanceBefore), token1BalanceAfter.sub(token1BalanceBefore));
      });

      it('tests token0 exactOutput (move up tick)', async () => {
        tickLower = nearestTickToPrice - 2 * tickDistance;
        tickUpper = nearestTickToPrice + 500 * tickDistance;
        await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION.mul(10), '0x');
        let token0BalanceBefore = await token0.balanceOf(user.address);
        let token1BalanceBefore = await token1.balanceOf(user.address);
        await logSwapState(SwapTitle.BEFORE_SWAP, pool);
        await callback.swap(
          pool.address,
          user.address,
          BN.from('-466751634178795601'),
          true,
          MAX_SQRT_RATIO.sub(ONE),
          '0x'
        );
        let token0BalanceAfter = await token0.balanceOf(user.address);
        let token1BalanceAfter = await token1.balanceOf(user.address);
        await logSwapState(SwapTitle.AFTER_SWAP, pool);
        logBalanceChange(token0BalanceAfter.sub(token0BalanceBefore), token1BalanceAfter.sub(token1BalanceBefore));
      });

      it('should fail if callback fails to send sufficient qty back to the pool', async () => {
        tickLower = nearestTickToPrice - 500 * tickDistance;
        tickUpper = nearestTickToPrice + 500 * tickDistance;
        await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION.mul(10), '0x');

        // downTick: send insufficient qty0
        await expect(
          callback.badSwap(pool.address, user.address, PRECISION.mul(-1), false, MIN_SQRT_RATIO.add(ONE), true, false)
        ).to.be.revertedWith('lacking deltaQty0');

        // upTick: send insufficient qty1
        await expect(
          callback.badSwap(pool.address, user.address, PRECISION.mul(-1), true, MAX_SQRT_RATIO.sub(ONE), false, true)
        ).to.be.revertedWith('lacking deltaQty1');
      });

      describe('fees', async () => {
        beforeEach('mint position and init rToken', async () => {
          tickLower = nearestTickToPrice - 100 * tickDistance;
          tickUpper = nearestTickToPrice + 100 * tickDistance;
          await callback.mint(
            pool.address,
            user.address,
            tickLower,
            tickUpper,
            ticksPrevious,
            PRECISION.mul(10),
            '0x'
          );
        });

        it('will not mint any rTokens if swaps fail to cross tick', async () => {
          await expect(
            callback.swap(pool.address, user.address, MIN_LIQUIDITY, false, MAX_SQRT_RATIO.sub(ONE), '0x')
          ).to.not.emit(pool, 'Transfer');
        });

        it('will mint rTokens but not transfer any for 0 governmentFeeBps', async () => {
          // cross initialized tick to mint rTokens
          await expect(
            callback.swap(pool.address, user.address, PRECISION, false, await getPriceFromTick(tickUpper + 1), '0x')
          ).to.emit(pool, 'Transfer');
          expect(await pool.balanceOf(ZERO_ADDRESS)).to.be.eq(ZERO);
        });

        it('should transfer rTokens to feeTo for non-zero governmentFeeBps', async () => {
          // set feeTo in factory
          await factory.updateFeeConfiguration(configMaster.address, 5);
          let feeToRTokenBalanceBefore = await pool.balanceOf(configMaster.address);
          // cross initialized tick to mint rTokens
          await swapToUpTick(pool, user, tickUpper + 1);
          expect(await pool.balanceOf(configMaster.address)).to.be.gt(feeToRTokenBalanceBefore);
        });

        it('should only send to updated feeTo address', async () => {
          // set feeTo in factory
          await factory.updateFeeConfiguration(admin.address, 5);
          // cross initialized tick to mint rTokens
          await swapToUpTick(pool, user, tickUpper + 1);
          let oldFeeToRTokenBalanceBefore = await pool.balanceOf(admin.address);
          let newFeeToRTokenBalanceBefore = await pool.balanceOf(configMaster.address);

          // now update to another feeTo
          await factory.updateFeeConfiguration(configMaster.address, 5);
          // swap downTick to generate fees and mint rTokens
          await swapToDownTick(pool, user, tickLower);

          // old feeTo should have same amount of rTokens
          expect(await pool.balanceOf(admin.address)).to.be.eq(oldFeeToRTokenBalanceBefore);
          // new feeTo should have received rTokens
          expect(await pool.balanceOf(configMaster.address)).to.be.gt(newFeeToRTokenBalanceBefore);
        });
      });
    });

    describe('init and test swaps near price boundaries', async () => {
      it('pool will not send any token0 at / near MAX_TICK', async () => {
        initialPrice = await getPriceFromTick(MAX_TICK.sub(2));
        await callback.unlockPool(pool.address, initialPrice, '0x');
        let token0BalanceBefore = await token0.balanceOf(pool.address);
        // swap uptick to MAX_TICK - 1
        await swapToUpTick(pool, user, MAX_TICK.toNumber() - 1);
        // await callback.connect(user).swap(pool.address, user.address, PRECISION, false, MAX_TICK.sub(1), '0x');
        // token0 balance should remain the same, but deltaQty0 can be 1 wei because of rounding
        expect(await token0.balanceOf(pool.address)).to.be.gte(token0BalanceBefore);
      });

      it('pool will not send any token1 at / near MIN_TICK', async () => {
        await callback.unlockPool(pool.address, await getPriceFromTick(MIN_TICK.add(2)), '0x');
        let token1BalanceBefore = await token1.balanceOf(pool.address);
        // swap downtick to MIN_TICK + 1
        await swapToDownTick(pool, user, MIN_TICK.toNumber() + 1);
        // check that token1 remains the same
        expect(await token1.balanceOf(pool.address)).to.be.eq(token1BalanceBefore);
      });
    });
  });

  describe('secondsPerLiquidity', async () => {
    it('should revert if bad range is given', async () => {
      await expect(pool.getSecondsPerLiquidityInside(10, 8)).to.be.revertedWith('bad tick range');
    });

    it('should return 0 if pool is locked', async () => {
      expect(await pool.getSecondsPerLiquidityInside(0, 10)).to.be.eql(ZERO);
      // forward time, should have no effect
      await pool.forwardTime(10);
      expect(await pool.getSecondsPerLiquidityInside(0, 10)).to.be.eql(ZERO);
    });

    it('should return 0 for 0 pool liquidity', async () => {
      await callback.connect(user).unlockPool(pool.address, encodePriceSqrt(ONE, ONE), '0x');
      expect(await pool.getSecondsPerLiquidityInside(0, 10)).to.be.eql(ZERO);
      // forward time, should have no effect
      await pool.forwardTime(10);
      expect(await pool.getSecondsPerLiquidityInside(0, 10)).to.be.eql(ZERO);
    });
  });

  describe('#flash', async () => {
    it('should fail if pool is not unlocked', async () => {
      await expect(callback.flash(pool.address, ZERO, ZERO, '0x')).to.be.revertedWith('locked');
    });

    describe('after unlockPool', async () => {
      beforeEach('unlock pool with initial price of 2:1 & mint 1 position', async () => {
        initialPrice = encodePriceSqrt(TWO, ONE);
        nearestTickToPrice = (await getNearestSpacedTickAtPrice(initialPrice, tickDistance)).toNumber();
        tickLower = nearestTickToPrice - 100 * tickDistance;
        tickUpper = nearestTickToPrice + 100 * tickDistance;
        await callback.unlockPool(pool.address, initialPrice, '0x');
        await factory.connect(admin).addNFTManager(callback.address);
        await callback.mint(pool.address, user.address, tickLower, tickUpper, ticksPrevious, PRECISION.mul(BPS), '0x');
      });

      it('should emit event', async () => {
        await expect(callback.flash(pool.address, PRECISION, PRECISION, '0x'))
          .to.emit(pool, 'Flash')
          .withArgs(callback.address, callback.address, PRECISION, PRECISION, ZERO, ZERO);
      });

      it('transfers requested loan to the recipient', async () => {
        await expect(callback.flash(pool.address, PRECISION, PRECISION.mul(TWO), '0x'))
          .to.emit(token0, 'Transfer')
          .withArgs(pool.address, callback.address, PRECISION)
          .to.emit(token1, 'Transfer')
          .withArgs(pool.address, callback.address, PRECISION.mul(TWO));
      });

      it('allows flash loan of only token0', async () => {
        await expect(callback.flash(pool.address, PRECISION, ZERO, '0x'))
          .to.emit(token0, 'Transfer')
          .withArgs(pool.address, callback.address, PRECISION)
          .to.not.emit(token1, 'Transfer');
      });

      it('allows flash loan of only token1', async () => {
        await expect(callback.flash(pool.address, ZERO, PRECISION, '0x'))
          .to.emit(token1, 'Transfer')
          .withArgs(pool.address, callback.address, PRECISION)
          .to.not.emit(token0, 'Transfer');
      });

      it('no-op if both amounts are 0', async () => {
        await expect(callback.flash(pool.address, ZERO, ZERO, '0x'))
          .to.not.emit(token0, 'Transfer')
          .to.not.emit(token1, 'Transfer');
      });

      it('allows flash loan of pool balance', async () => {
        let poolBal0 = await token0.balanceOf(pool.address);
        let poolBal1 = await token0.balanceOf(pool.address);
        await expect(callback.flash(pool.address, poolBal0, poolBal1, '0x'))
          .to.emit(token0, 'Transfer')
          .withArgs(pool.address, callback.address, poolBal0)
          .to.emit(token1, 'Transfer')
          .withArgs(pool.address, callback.address, poolBal1);
      });

      it('should revert if requested loan amount exceeds pool balance', async () => {
        let poolBal0 = await token0.balanceOf(pool.address);
        let poolBal1 = await token1.balanceOf(pool.address);
        await expect(callback.flash(pool.address, poolBal0.add(ONE), poolBal1, '0x')).to.be.reverted;
        await expect(callback.flash(pool.address, poolBal0, poolBal1.add(ONE), '0x')).to.be.reverted;
      });

      it('should revert if recipient fails to pay back loan', async () => {
        await expect(callback.badFlash(pool.address, PRECISION, PRECISION, true, false, false)).to.be.revertedWith(
          'lacking feeQty0'
        );
        await expect(callback.badFlash(pool.address, PRECISION, PRECISION, false, true, false)).to.be.revertedWith(
          'lacking feeQty1'
        );
      });

      describe('turn on fee', async () => {
        beforeEach('set feeTo', async () => {
          // set feeTo in factory
          await factory.updateFeeConfiguration(configMaster.address, 5);
        });

        it('should revert if recipient pays insufficient fees', async () => {
          await expect(callback.badFlash(pool.address, PRECISION, PRECISION, true, false, true)).to.be.revertedWith(
            'lacking feeQty0'
          );
          await expect(callback.badFlash(pool.address, PRECISION, PRECISION, false, true, true)).to.be.revertedWith(
            'lacking feeQty1'
          );
        });

        it('should not revert if recipient overpays', async () => {
          // send tokens to callback so that it will overpay
          await token0.transfer(callback.address, PRECISION);
          await expect(callback.flash(pool.address, PRECISION, PRECISION, '0x')).to.not.be.reverted;
          await token1.transfer(callback.address, PRECISION);
          await expect(callback.flash(pool.address, PRECISION, PRECISION, '0x')).to.not.be.reverted;
        });

        it('should send collected fees to feeTo if not null', async () => {
          let swapFee = PRECISION.mul(swapFeeBps).div(BPS);
          await expect(callback.flash(pool.address, PRECISION, PRECISION, '0x'))
            .to.emit(token0, 'Transfer')
            .withArgs(pool.address, configMaster.address, swapFee)
            .to.emit(token1, 'Transfer')
            .withArgs(pool.address, configMaster.address, swapFee);
        });

        it('should send only token0 fees if loan is taken in only token0', async () => {
          // set feeTo in factory
          await factory.updateFeeConfiguration(configMaster.address, 5);
          let swapFee = PRECISION.mul(swapFeeBps).div(BPS);
          await expect(callback.flash(pool.address, PRECISION, ZERO, '0x'))
            .to.emit(token0, 'Transfer')
            .withArgs(pool.address, configMaster.address, swapFee)
            .to.not.emit(token1, 'Transfer');
        });

        it('should send only token1 fees if loan is taken in only token1', async () => {
          // set feeTo in factory
          await factory.updateFeeConfiguration(configMaster.address, 5);
          let swapFee = PRECISION.mul(swapFeeBps).div(BPS);
          await expect(callback.flash(pool.address, ZERO, PRECISION, '0x'))
            .to.emit(token1, 'Transfer')
            .withArgs(pool.address, configMaster.address, swapFee)
            .to.not.emit(token0, 'Transfer');
        });
      });

      it('#gas flash [ @skip-on-coverage ]', async () => {
        const tx = await callback.connect(user).flash(pool.address, PRECISION, PRECISION, '0x');
        await snapshotGasCost(tx);
      });
    });
  });
});

async function isTickCleared (tick: number): Promise<boolean> {
  const {liquidityGross, feeGrowthOutside, liquidityNet} = await pool.ticks(tick);
  if (!feeGrowthOutside.eq(ZERO)) return false;
  if (!liquidityNet.eq(ZERO)) return false;
  if (!liquidityGross.eq(ZERO)) return false;
  return true;
}

async function doRandomSwaps (pool: MockPool, user: Wallet, iterations: number, maxSwapQty?: BN) {
  for (let i = 0; i < iterations; i++) {
    let isToken0 = Math.random() < 0.5;
    let isExactInput = Math.random() < 0.5;
    const maxRange = maxSwapQty ? maxSwapQty : PRECISION.mul(BPS);
    let swapQty = genRandomBN(maxRange.div(2), maxRange);
    if (!isExactInput) {
      let token = isToken0 ? token0 : token1;
      let poolBal = await token.balanceOf(pool.address);
      if (swapQty.gt(poolBal)) swapQty = genRandomBN(ONE, poolBal);
      swapQty = swapQty.mul(-1);
    }
    let priceLimit;
    // willUpTick = exactInputToken1 or exactOutputToken0
    if ((isExactInput && !isToken0) || (!isExactInput && isToken0)) {
      priceLimit = MAX_SQRT_RATIO.sub(ONE);
    } else {
      priceLimit = MIN_SQRT_RATIO.add(ONE);
    }
    // console.log(`swapping ${swapQty.toString()}`);
    // console.log(`isToken0=${isToken0} isExactInput=${isExactInput}`);
    await callback.connect(user).swap(pool.address, user.address, swapQty, isToken0, priceLimit, '0x');
    // advance time between each swap
    await pool.forwardTime(3);
  }
}

async function swapToUpTick (pool: MockPool, user: Wallet, targetTick: number, maxSwapQty?: BN) {
  while ((await pool.getPoolState()).currentTick < targetTick) {
    // either specify exactInputToken1 or exactOutputToken0
    let isToken0 = Math.random() < 0.5;
    let isExactInput = !isToken0;
    const maxRange = maxSwapQty ? maxSwapQty : PRECISION.mul(BPS);
    let swapQty = genRandomBN(maxRange.div(2), maxRange);
    if (!isExactInput) {
      let token = isToken0 ? token0 : token1;
      let poolBal = await token.balanceOf(pool.address);
      if (swapQty.gt(poolBal)) swapQty = genRandomBN(ONE, poolBal);
      swapQty = swapQty.mul(-1);
    }
    await callback
      .connect(user)
      .swap(pool.address, user.address, swapQty, isToken0, await getPriceFromTick(targetTick), '0x');
    // advance time between each swap
    await pool.forwardTime(3);
  }
}

async function swapToDownTick (pool: MockPool, user: Wallet, targetTick: number, maxSwapQty?: BN) {
  while ((await pool.getPoolState()).currentTick > targetTick) {
    // either specify exactInputToken0 or exactOutputToken1
    let isToken0 = Math.random() < 0.5;
    let isExactInput = isToken0;
    const maxRange = maxSwapQty ? maxSwapQty : PRECISION.mul(BPS);
    let swapQty = genRandomBN(maxRange.div(2), maxRange);
    if (!isExactInput) {
      let token = isToken0 ? token0 : token1;
      let poolBal = await token.balanceOf(pool.address);
      if (swapQty.gt(poolBal)) swapQty = genRandomBN(ONE, poolBal);
      swapQty = swapQty.mul(-1);
    }
    await callback
      .connect(user)
      .swap(pool.address, user.address, swapQty, isToken0, await getPriceFromTick(targetTick), '0x');
    // advance time between each swap
    await pool.forwardTime(3);
  }
}
