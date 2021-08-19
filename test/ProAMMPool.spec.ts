import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {
  PRECISION,
  ZERO_ADDRESS,
  ZERO,
  ONE,
  MAX_UINT,
  MIN_LIQUIDITY,
  MIN_TICK,
  MAX_TICK,
  MIN_SQRT_RATIO,
  MAX_SQRT_RATIO,
  TWO,
  BPS,
  BN,
  MAX_TICK_DISTANCE,
} from './helpers/helper';
import {snapshotGasCost} from './helpers/utils';
import chai from 'chai';
const {solidity, loadFixture} = waffle;
chai.use(solidity);

import {
  ProAMMFactory,
  ProAMMPool,
  MockToken,
  MockToken__factory,
  MockProAMMCallbacks,
  ProAMMPool__factory,
} from '../typechain';
import {deployFactory} from './helpers/proAMMSetup';
import {
  BigNumber,
  encodePriceSqrt,
  getMaxTick,
  getMinTick,
  getNearestSpacedTickAtPrice,
  getPositionKey,
  getPriceFromTick,
} from './helpers/utils';
import {genRandomBN} from './helpers/genRandomBN';
import {Wallet} from '@ethereum-waffle/provider/node_modules/ethers';
import {logBalanceChange, logSwapState, SwapTitle} from './helpers/logger';

let factory: ProAMMFactory;
let token0: MockToken;
let token1: MockToken;
let reinvestmentToken: MockToken;
let poolBalToken0: BigNumber;
let poolBalToken1: BigNumber;
let poolArray: ProAMMPool[] = [];
let pool: ProAMMPool;
let callback: MockProAMMCallbacks;
let swapFeeBpsArray = [5, 30];
let swapFeeBps = swapFeeBpsArray[0];
let tickSpacingArray = [10, 60];
let tickSpacing = tickSpacingArray[0];

let minTick = getMinTick(tickSpacing);
let maxTick = getMaxTick(tickSpacing);
let initialPrice: BigNumber;
let nearestTickToPrice: number;
let tickLower: number;
let tickUpper: number;
let tickLowerData: any;
let tickUpperData: any;
let positionKey: any;
let positionData: any;
let result: any;

class Fixtures {
  constructor(
    public factory: ProAMMFactory,
    public poolArray: ProAMMPool[],
    public token0: MockToken,
    public token1: MockToken,
    public callback: MockProAMMCallbacks
  ) {}
}

describe('ProAMMPool', () => {
  const [user, admin, feeToSetter] = waffle.provider.getWallets();

  async function fixture(): Promise<Fixtures> {
    let factory = await deployFactory(admin);
    const ProAMMPoolContract = (await ethers.getContractFactory('ProAMMPool')) as ProAMMPool__factory;
    // add any newly defined tickSpacing apart from default ones
    for (let i = 0; i < swapFeeBpsArray.length; i++) {
      if ((await factory.feeAmountTickSpacing(swapFeeBpsArray[i])) == 0) {
        await factory.connect(admin).enableSwapFee(swapFeeBpsArray[i], tickSpacingArray[i]);
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
      poolArray.push(ProAMMPoolContract.attach(poolAddress));
    }

    const CallbackContract = await ethers.getContractFactory('MockProAMMCallbacks');
    callback = (await CallbackContract.deploy(tokenA.address, tokenB.address)) as MockProAMMCallbacks;
    // user give token approval to callbacks
    await tokenA.connect(user).approve(callback.address, MAX_UINT);
    await tokenB.connect(user).approve(callback.address, MAX_UINT);

    return new Fixtures(factory, poolArray, token0, token1, callback);
  }

  beforeEach('load fixture', async () => {
    ({factory, poolArray, token0, token1, callback} = await loadFixture(fixture));
    pool = poolArray[0];
  });

  describe('#test pool deployment and initialization', async () => {
    it('should have initialized required settings', async () => {
      expect(await pool.factory()).to.be.eql(factory.address);
      expect(await pool.token0()).to.be.eql(token0.address);
      expect(await pool.token1()).to.be.eql(token1.address);
      expect(await pool.swapFeeBps()).to.be.eql(swapFeeBps);
      expect(await pool.tickSpacing()).to.be.eql(tickSpacing);
      expect(await pool.maxLiquidityPerTick()).to.be.gt(ZERO);
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

    it('should fail if initial tick is outside of min and max ticks', async () => {
      // initial tick < lower tick
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
      const tx = await callback.connect(user).unlockPool(pool.address, initialPrice, '0x');
      await snapshotGasCost(tx);

      result = await pool.getPoolState();
      expect(result._poolSqrtPrice).to.be.eql(initialPrice);
      expect(result._poolTick).to.be.eql(10);
      expect(result._locked).to.be.false;
      expect(result._poolLiquidity).to.be.eql(ZERO);

      result = await pool.getReinvestmentState();
      expect(result._poolFeeGrowthGlobal).to.be.eql(ZERO);
      expect(result._poolReinvestmentLiquidity).to.be.eql(MIN_LIQUIDITY);
      expect(result._poolReinvestmentLiquidityLast).to.be.eql(MIN_LIQUIDITY);

      expect(await pool.reinvestmentToken()).to.not.be.eql(ZERO_ADDRESS);
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
      await expect(callback.mint(pool.address, user.address, 0, 100, PRECISION, '0x')).to.be.revertedWith('locked');
    });

    describe('after unlockPool', async () => {
      beforeEach('unlock pool with initial price of 2:1', async () => {
        await callback.unlockPool(pool.address, encodePriceSqrt(TWO, ONE), '0x');
      });

      it('should fail if ticks are not in tick spacing', async () => {
        await expect(callback.mint(pool.address, user.address, 4, 8, PRECISION, '0x')).to.be.revertedWith(
          'tick not in spacing'
        );
      });

      it('should fail if tickLower > tickUpper', async () => {
        await expect(callback.mint(pool.address, user.address, 9, 8, PRECISION, '0x')).to.be.revertedWith(
          'invalid ticks'
        );
      });

      it('should fail if lower tick < MIN_TICK', async () => {
        await expect(
          callback.mint(pool.address, user.address, MIN_TICK.sub(ONE), 0, PRECISION, '0x')
        ).to.be.revertedWith('invalid lower tick');
      });

      it('should fail if upper tick > MAX_TICK', async () => {
        await expect(
          callback.mint(pool.address, user.address, 0, MAX_TICK.add(ONE), PRECISION, '0x')
        ).to.be.revertedWith('invalid upper tick');
      });

      it('should fail if liquidity added exceeds maxLiquidityPerTick', async () => {
        await expect(
          callback.mint(pool.address, user.address, 0, 10, (await pool.maxLiquidityPerTick()).add(ONE), '0x')
        ).to.be.revertedWith('> max liquidity');
      });

      it('should fail if liquidity gross of a tick exceeds maxLiquidityPerTick', async () => {
        let maxLiquidityGross = await pool.maxLiquidityPerTick();
        // mint new position with MIN_LIQUIDITY
        await callback.mint(
          pool.address,
          user.address,
          minTick + tickSpacing,
          maxTick - tickSpacing,
          MIN_LIQUIDITY,
          '0x'
        );
        let exceedingLiquidity = maxLiquidityGross.sub(MIN_LIQUIDITY).add(ONE);

        await expect(
          callback.mint(pool.address, user.address, minTick + tickSpacing, maxTick, exceedingLiquidity, '0x')
        ).to.be.revertedWith('> max liquidity');

        await expect(
          callback.mint(pool.address, user.address, minTick, maxTick - tickSpacing, exceedingLiquidity, '0x')
        ).to.be.revertedWith('> max liquidity');

        // should work if liquidityGross = maxLiquidityPerTick
        await expect(
          callback.mint(
            pool.address,
            user.address,
            minTick + tickSpacing,
            maxTick - tickSpacing,
            exceedingLiquidity.sub(ONE),
            '0x'
          )
        ).to.not.be.reverted;
      });

      it('should fail for 0 qty', async () => {
        await expect(callback.mint(pool.address, user.address, 0, 100, 0, '0x')).to.be.revertedWith('0 qty');
      });

      it('should fail if insufficient tokens are sent for minting', async () => {
        await expect(
          callback.badMint(pool.address, user.address, minTick, maxTick, MIN_LIQUIDITY, true, false)
        ).to.be.revertedWith('lacking qty0');

        await expect(
          callback.badMint(pool.address, user.address, minTick, maxTick, MIN_LIQUIDITY, false, true)
        ).to.be.revertedWith('lacking qty1');
      });

      describe('successful mints', async () => {
        beforeEach('fetch initial token balances of pool and user, and current tick', async () => {
          poolBalToken0 = await token0.balanceOf(pool.address);
          poolBalToken1 = await token1.balanceOf(pool.address);
          initialPrice = (await pool.getPoolState())._poolSqrtPrice;
        });
        describe('position above current tick', async () => {
          beforeEach('reset position data', async () => {
            nearestTickToPrice = (await getNearestSpacedTickAtPrice(initialPrice, tickSpacing)).toNumber();
            tickLower = nearestTickToPrice + tickSpacing;
            tickUpper = nearestTickToPrice + 5 * tickSpacing;
            positionKey = getPositionKey(user.address, tickLower, tickUpper);
            tickLowerData = await pool.ticks(tickLower);
            tickUpperData = await pool.ticks(tickUpper);
          });

          it('should only transfer token0', async () => {
            await expect(callback.mint(pool.address, user.address, tickLower, tickUpper, MIN_LIQUIDITY, '0x'))
              .to.emit(token0, 'Transfer')
              .to.not.emit(token1, 'Transfer');
            expect(await token0.balanceOf(pool.address)).to.be.gt(poolBalToken0);
            expect(await token1.balanceOf(pool.address)).to.be.eql(poolBalToken1);
          });

          it('should take larger token0 qty for larger liquidity', async () => {
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION.div(MIN_LIQUIDITY), '0x');
            let token0Taken = (await token0.balanceOf(pool.address)).sub(poolBalToken0);
            poolBalToken0 = await token0.balanceOf(pool.address);
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            expect((await token0.balanceOf(pool.address)).sub(poolBalToken0)).to.be.gt(token0Taken);
          });

          it('should mint for extreme max position', async () => {
            let maxLiquidityGross = await pool.maxLiquidityPerTick();
            await callback.mint(
              pool.address,
              user.address,
              maxTick - tickSpacing,
              maxTick,
              maxLiquidityGross.sub(MIN_LIQUIDITY.mul(TWO)),
              '0x'
            );
            expect(await token0.balanceOf(pool.address)).to.be.gt(poolBalToken0);
            expect(await token1.balanceOf(pool.address)).to.be.eql(poolBalToken1);
          });

          it('should have incremented user position liquidity and unchanged feeGrowthInsideLast', async () => {
            positionData = await pool.positions(positionKey);
            expect(positionData.liquidity).to.be.eql(ZERO);
            // no swap, no fees
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            positionData = await pool.positions(positionKey);
            expect((await pool.positions(positionKey)).liquidity).to.be.eql(PRECISION);
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
          });

          it('should not increment pool liquidity', async () => {
            let poolLiquidityBefore = (await pool.getPoolState())._poolLiquidity;
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            expect((await pool.getPoolState())._poolLiquidity).to.be.eql(poolLiquidityBefore);
          });

          it('should correctly adjust tickLower and tickUpper data', async () => {
            // liquidityGross
            expect(tickLowerData.liquidityGross).to.be.eql(ZERO);
            expect(tickUpperData.liquidityGross).to.be.eql(ZERO);
            // initialized
            expect(tickLowerData.initialized).to.be.false;
            expect(tickUpperData.initialized).to.be.false;
            // feeGrowthOutside
            expect(tickLowerData.feeGrowthOutside).to.be.eql(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.eql(ZERO);

            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');

            tickLowerData = await pool.ticks(tickLower);
            tickUpperData = await pool.ticks(tickUpper);

            // liquidityGross
            expect(tickLowerData.liquidityGross).to.be.eql(PRECISION);
            expect(tickUpperData.liquidityGross).to.be.eql(PRECISION);
            // initialized
            expect(tickLowerData.initialized).to.be.true;
            expect(tickUpperData.initialized).to.be.true;
            // feeGrowthOutside
            expect(tickLowerData.feeGrowthOutside).to.be.eql(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.eql(ZERO);
          });

          it('should not change initialized ticks status or update feeGrowthOutside for liquidity addition', async () => {
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            // add liquidity
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');

            // should be unchanged
            expect((await pool.ticks(tickLower)).initialized).to.be.true;
            expect((await pool.ticks(tickUpper)).initialized).to.be.true;
            expect((await pool.ticks(tickLower)).feeGrowthOutside).to.be.eql(ZERO);
            expect((await pool.ticks(tickUpper)).feeGrowthOutside).to.be.eql(ZERO);
          });

          it('should add on liquidity to same position', async () => {
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            positionData = await pool.positions(positionKey);
            expect(positionData.liquidity).to.be.eql(PRECISION);
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
            // add on more liquidity
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            positionData = await pool.positions(positionKey);
            expect(positionData.liquidity).to.be.eql(PRECISION.mul(TWO));
            // no change in fees since no swap performed
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
          });

          it('should correctly update position state if adding liquidity after swap cross into position', async () => {
            // provide enough liquidity to swap to tickUpper
            await callback.mint(
              pool.address,
              user.address,
              tickLower - 5 * tickSpacing,
              tickUpper + 5 * tickSpacing,
              PRECISION.mul(BPS),
              '0x'
            );
            // mint new position
            let tx = await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            await snapshotGasCost(tx);
            positionData = await pool.positions(positionKey);
            expect(positionData.liquidity).to.be.eql(PRECISION);
            // no swap, no fees
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
            // do swaps to cross into position
            await swapToUpTick(pool, user, tickUpper);
            // add on more liquidity
            tx = await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            await snapshotGasCost(tx);

            positionData = await pool.positions(positionKey);
            expect(positionData.liquidity).to.be.eql(PRECISION.mul(TWO));
            // should have increased fees
            expect(positionData.feeGrowthInsideLast).to.be.gt(ZERO);
          });
        });

        describe('position includes current tick', async () => {
          beforeEach('reset position data', async () => {
            nearestTickToPrice = (await getNearestSpacedTickAtPrice(initialPrice, tickSpacing)).toNumber();
            tickLower = nearestTickToPrice - 2 * tickSpacing;
            tickUpper = nearestTickToPrice + 2 * tickSpacing;
            positionKey = getPositionKey(user.address, tickLower, tickUpper);
            tickLowerData = await pool.ticks(tickLower);
            tickUpperData = await pool.ticks(tickUpper);
          });

          it('should transfer both token0 and token1', async () => {
            await expect(callback.mint(pool.address, user.address, tickLower, tickUpper, MIN_LIQUIDITY, '0x'))
              .to.emit(token0, 'Transfer')
              .to.emit(token1, 'Transfer');
            expect(await token0.balanceOf(pool.address)).to.be.gt(poolBalToken0);
            expect(await token1.balanceOf(pool.address)).to.be.gt(poolBalToken1);
          });

          it('should take larger token0 and token1 qtys for larger liquidity', async () => {
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION.div(MIN_LIQUIDITY), '0x');
            let token0Taken = (await token0.balanceOf(pool.address)).sub(poolBalToken0);
            let token1Taken = (await token1.balanceOf(pool.address)).sub(poolBalToken1);
            poolBalToken0 = await token0.balanceOf(pool.address);
            poolBalToken1 = await token1.balanceOf(pool.address);
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            expect((await token0.balanceOf(pool.address)).sub(poolBalToken0)).to.be.gt(token0Taken);
            expect((await token1.balanceOf(pool.address)).sub(poolBalToken1)).to.be.gt(token1Taken);
          });

          it('should mint for extreme position', async () => {
            let maxLiquidityGross = await pool.maxLiquidityPerTick();
            await callback.mint(
              pool.address,
              user.address,
              minTick,
              minTick + tickSpacing,
              maxLiquidityGross.sub(MIN_LIQUIDITY.mul(TWO)),
              '0x'
            );
            expect(await token0.balanceOf(pool.address)).to.be.eql(poolBalToken0);
            expect(await token1.balanceOf(pool.address)).to.be.gt(poolBalToken1);
          });

          it('should have incremented user position liquidity and unchanged feeGrowthInsideLast', async () => {
            positionData = await pool.positions(positionKey);
            expect(positionData.liquidity).to.be.eql(ZERO);
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            positionData = await pool.positions(positionKey);
            expect(positionData.liquidity).to.be.eql(PRECISION);
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
          });

          it('should have incremented pool liquidity', async () => {
            let poolLiquidityBefore = (await pool.getPoolState())._poolLiquidity;
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            expect((await pool.getPoolState())._poolLiquidity).to.be.eql(poolLiquidityBefore.add(PRECISION));
          });

          it('should correctly adjust tickLower and tickUpper data', async () => {
            // liquidityGross
            expect(tickLowerData.liquidityGross).to.be.eql(ZERO);
            expect(tickUpperData.liquidityGross).to.be.eql(ZERO);
            // initialized
            expect(tickLowerData.initialized).to.be.false;
            expect(tickUpperData.initialized).to.be.false;
            // feeGrowthOutside
            expect(tickLowerData.feeGrowthOutside).to.be.eql(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.eql(ZERO);

            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');

            tickLowerData = await pool.ticks(tickLower);
            tickUpperData = await pool.ticks(tickUpper);

            // liquidityGross
            expect(tickLowerData.liquidityGross).to.be.eql(PRECISION);
            expect(tickUpperData.liquidityGross).to.be.eql(PRECISION);
            // initialized
            expect(tickLowerData.initialized).to.be.true;
            expect(tickUpperData.initialized).to.be.true;
            // feeGrowthOutside
            expect(tickLowerData.feeGrowthOutside).to.be.eql(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.eql(ZERO);
          });

          it('should instantiate tick lower feeGrowthOutside for mint', async () => {
            // feeGrowthOutside
            expect(tickLowerData.feeGrowthOutside).to.be.eql(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.eql(ZERO);

            // provide enough liquidity so that lc collected > 0 when swapping
            await callback.mint(
              pool.address,
              user.address,
              nearestTickToPrice - 100 * tickSpacing,
              nearestTickToPrice + 100 * tickSpacing,
              PRECISION,
              '0x'
            );
            await swapToUpTick(pool, user, nearestTickToPrice + MAX_TICK_DISTANCE + 1);
            await swapToDownTick(pool, user, nearestTickToPrice);

            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');

            tickLowerData = await pool.ticks(tickLower);
            tickUpperData = await pool.ticks(tickUpper);

            // feeGrowthOutside
            expect(tickLowerData.feeGrowthOutside).to.be.gt(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.eql(ZERO);
          });

          it('should not change initialized ticks status or update feeGrowthOutside for liquidity addition', async () => {
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            let feeGrowthOutsideTickLower = (await pool.ticks(tickLower)).feeGrowthOutside;
            expect(feeGrowthOutsideTickLower).to.be.eql(ZERO);
            // add liquidity
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');

            // should be unchanged
            expect((await pool.ticks(tickLower)).initialized).to.be.true;
            expect((await pool.ticks(tickUpper)).initialized).to.be.true;
            expect((await pool.ticks(tickLower)).feeGrowthOutside).to.be.eql(feeGrowthOutsideTickLower);
            expect((await pool.ticks(tickUpper)).feeGrowthOutside).to.be.eql(ZERO);
          });

          it('should add on liquidity to same position', async () => {
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            positionData = await pool.positions(positionKey);
            expect(positionData.liquidity).to.be.eql(PRECISION);
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
            // add on more liquidity
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            positionData = await pool.positions(positionKey);
            expect(positionData.liquidity).to.be.eql(PRECISION.mul(TWO));
            // no change in fees since no swap performed
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
          });

          it('should correctly update position state if adding liquidity after swap cross into position', async () => {
            // provide enough liquidity to swap to tickUpper
            await callback.mint(
              pool.address,
              user.address,
              tickLower - 5 * tickSpacing,
              tickUpper + 5 * tickSpacing,
              PRECISION.mul(BPS),
              '0x'
            );
            // mint new position
            let tx = await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            await snapshotGasCost(tx);
            positionData = await pool.positions(positionKey);
            expect(positionData.liquidity).to.be.eql(PRECISION);
            // no swap, no fees
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
            // do a few swaps, since price is in position, direction doesnt matter
            await doRandomSwaps(pool, user, 3);
            // add on more liquidity
            tx = await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            await snapshotGasCost(tx);

            positionData = await pool.positions(positionKey);
            expect(positionData.liquidity).to.be.eql(PRECISION.mul(TWO));
            // should have increased fees
            expect(positionData.feeGrowthInsideLast).to.be.gt(ZERO);
          });
        });

        describe('position below current tick', async () => {
          beforeEach('reset position data', async () => {
            nearestTickToPrice = (await getNearestSpacedTickAtPrice(initialPrice, tickSpacing)).toNumber();
            tickLower = nearestTickToPrice - 5 * tickSpacing;
            tickUpper = nearestTickToPrice - 2 * tickSpacing;
            positionKey = getPositionKey(user.address, tickLower, tickUpper);
            tickLowerData = await pool.ticks(tickLower);
            tickUpperData = await pool.ticks(tickUpper);
          });

          it('should only transfer token1', async () => {
            await expect(callback.mint(pool.address, user.address, tickLower, tickUpper, MIN_LIQUIDITY, '0x'))
              .to.emit(token1, 'Transfer')
              .to.not.emit(token0, 'Transfer');
            expect(await token0.balanceOf(pool.address)).to.be.eql(poolBalToken0);
            expect(await token1.balanceOf(pool.address)).to.be.gt(poolBalToken1);
          });

          it('should take larger token1 qty for larger liquidity', async () => {
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION.div(MIN_LIQUIDITY), '0x');
            let token1Taken = (await token1.balanceOf(pool.address)).sub(poolBalToken1);
            poolBalToken1 = await token1.balanceOf(pool.address);
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            expect((await token1.balanceOf(pool.address)).sub(poolBalToken1)).to.be.gt(token1Taken);
          });

          it('should mint for extreme position', async () => {
            let maxLiquidityGross = await pool.maxLiquidityPerTick();
            await callback.mint(
              pool.address,
              user.address,
              minTick,
              maxTick,
              maxLiquidityGross.sub(MIN_LIQUIDITY.mul(TWO)),
              '0x'
            );
            expect(await token0.balanceOf(pool.address)).to.be.gt(poolBalToken0);
            expect(await token1.balanceOf(pool.address)).to.be.gt(poolBalToken1);
          });

          it('should have incremented user position liquidity and unchanged feeGrowthInsideLast', async () => {
            positionData = await pool.positions(positionKey);
            expect(positionData.liquidity).to.be.eql(ZERO);
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            positionData = await pool.positions(positionKey);
            expect(positionData.liquidity).to.be.eql(PRECISION);
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
          });

          it('should not increment pool liquidity', async () => {
            let poolLiquidityBefore = (await pool.getPoolState())._poolLiquidity;
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            expect((await pool.getPoolState())._poolLiquidity).to.be.eql(poolLiquidityBefore);
          });

          it('should correctly adjust tickLower and tickUpper data', async () => {
            // liquidityGross
            expect(tickLowerData.liquidityGross).to.be.eql(ZERO);
            expect(tickUpperData.liquidityGross).to.be.eql(ZERO);
            // initialized
            expect(tickLowerData.initialized).to.be.false;
            expect(tickUpperData.initialized).to.be.false;
            // feeGrowthOutside
            expect(tickLowerData.feeGrowthOutside).to.be.eql(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.eql(ZERO);

            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');

            tickLowerData = await pool.ticks(tickLower);
            tickUpperData = await pool.ticks(tickUpper);

            // liquidityGross
            expect(tickLowerData.liquidityGross).to.be.eql(PRECISION);
            expect(tickUpperData.liquidityGross).to.be.eql(PRECISION);
            // initialized
            expect(tickLowerData.initialized).to.be.true;
            expect(tickUpperData.initialized).to.be.true;
            // feeGrowthOutside
            expect(tickLowerData.feeGrowthOutside).to.be.eql(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.eql(ZERO);
          });

          it('should instantiate both tick lower and tick upper feeGrowthOutside for mint', async () => {
            // feeGrowthOutside
            expect(tickLowerData.feeGrowthOutside).to.be.eql(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.eql(ZERO);

            // provide enough liquidity so that lc collected > 0 when swapping
            await callback.mint(
              pool.address,
              user.address,
              nearestTickToPrice - 100 * tickSpacing,
              nearestTickToPrice + 100 * tickSpacing,
              PRECISION,
              '0x'
            );
            await swapToDownTick(pool, user, nearestTickToPrice - MAX_TICK_DISTANCE - 1);
            await swapToUpTick(pool, user, nearestTickToPrice);

            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');

            tickLowerData = await pool.ticks(tickLower);
            tickUpperData = await pool.ticks(tickUpper);

            // feeGrowthOutside
            expect(tickLowerData.feeGrowthOutside).to.be.gt(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.gt(ZERO);
          });

          it('should not change initialized ticks status or update feeGrowthOutside for liquidity addition', async () => {
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            let feeGrowthOutside = (await pool.ticks(tickLower)).feeGrowthOutside;
            expect(feeGrowthOutside).to.be.eql(ZERO);
            expect((await pool.ticks(tickUpper)).feeGrowthOutside).to.be.eql(feeGrowthOutside);
            // add liquidity
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');

            // should be unchanged
            expect((await pool.ticks(tickLower)).initialized).to.be.true;
            expect((await pool.ticks(tickUpper)).initialized).to.be.true;
            expect((await pool.ticks(tickLower)).feeGrowthOutside).to.be.eql(feeGrowthOutside);
            expect((await pool.ticks(tickUpper)).feeGrowthOutside).to.be.eql(feeGrowthOutside);
          });

          it('should add on liquidity to same position', async () => {
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            positionData = await pool.positions(positionKey);
            expect(positionData.liquidity).to.be.eql(PRECISION);
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
            // add on more liquidity
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            positionData = await pool.positions(positionKey);
            expect(positionData.liquidity).to.be.eql(PRECISION.mul(TWO));
            // no change in fees since no swap performed
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
          });

          it('should correctly update position state if adding liquidity after swap cross into position', async () => {
            // provide enough liquidity to swap to tickUpper
            await callback.mint(
              pool.address,
              user.address,
              tickLower - 5 * tickSpacing,
              tickUpper + 5 * tickSpacing,
              PRECISION.mul(BPS),
              '0x'
            );
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            positionData = await pool.positions(positionKey);
            expect(positionData.liquidity).to.be.eql(PRECISION);
            // no swap, no fees
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
            // swap to cross into position
            await swapToDownTick(pool, user, tickLower);
            // add on more liquidity
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            positionData = await pool.positions(positionKey);
            expect(positionData.liquidity).to.be.eql(PRECISION.mul(TWO));
            // should have increased fees
            expect(positionData.feeGrowthInsideLast).to.be.gt(ZERO);
          });
        });

        describe('overlapping positions', async () => {
          it('should have 0 liquidityNet but liquidity gross != 0 if tickUpper of 1 position == tickLower of another', async () => {
            nearestTickToPrice = (await getNearestSpacedTickAtPrice(initialPrice, tickSpacing)).toNumber();
            tickLower = nearestTickToPrice - tickSpacing;
            tickUpper = nearestTickToPrice + tickSpacing;
            // mint lower position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            tickLower = tickUpper;
            tickUpper = tickUpper + tickSpacing;
            // mint upper position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            // check overlapping tick data
            result = await pool.ticks(tickLower);
            expect(result.liquidityGross).to.not.eql(ZERO);
            expect(result.liquidityNet).to.eql(ZERO);
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
      beforeEach('unlock pool with initial price of 2:1, mint 1 position, init reinvestment token', async () => {
        initialPrice = encodePriceSqrt(TWO, ONE);
        nearestTickToPrice = (await getNearestSpacedTickAtPrice(initialPrice, tickSpacing)).toNumber();
        tickLower = nearestTickToPrice - 100 * tickSpacing;
        tickUpper = nearestTickToPrice + 100 * tickSpacing;
        await callback.unlockPool(pool.address, initialPrice, '0x');
        await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION.mul(BPS), '0x');
        reinvestmentToken = (await ethers.getContractAt(
          'IReinvestmentToken',
          await pool.reinvestmentToken()
        )) as MockToken;
      });

      it('should fail burning more than position liquidity', async () => {
        await expect(pool.connect(user).burn(tickLower, tickUpper, PRECISION.mul(BPS).add(ONE))).to.be.reverted;
      });

      it('should retain fee growth position snapshot after all user liquidity is removed', async () => {
        // swap to outside user position to update feeGrowthGlobal
        await swapToUpTick(pool, user, tickUpper + 1);
        await pool.connect(user).burn(tickLower, tickUpper, PRECISION.mul(BPS));
        result = await pool.positions(getPositionKey(user.address, tickLower, tickUpper));
        expect(result.liquidity).to.be.eql(ZERO);
        expect(result.feeGrowthInsideLast).to.be.gt(ZERO);
      });

      it('should clear the tick if last position containing it is cleared', async () => {
        await callback.mint(
          pool.address,
          user.address,
          tickLower + tickSpacing,
          tickUpper - tickSpacing,
          PRECISION,
          '0x'
        );
        await doRandomSwaps(pool, user, 3);
        await pool.connect(user).burn(tickLower + tickSpacing, tickUpper - tickSpacing, PRECISION);
        expect(await isTickCleared(tickLower + tickSpacing)).to.be.true;
        expect(await isTickCleared(tickUpper - tickSpacing)).to.be.true;
      });

      it('should clear only lower tick if upper remains used', async () => {
        await callback.mint(pool.address, user.address, tickLower + tickSpacing, tickUpper, PRECISION, '0x');
        await doRandomSwaps(pool, user, 3);
        await pool.connect(user).burn(tickLower + tickSpacing, tickUpper, PRECISION);
        expect(await isTickCleared(tickLower + tickSpacing)).to.be.true;
        expect(await isTickCleared(tickUpper)).to.be.false;
      });

      it('should clear only upper tick if lower remains used', async () => {
        await callback.mint(pool.address, user.address, tickLower, tickUpper - tickSpacing, PRECISION, '0x');
        await doRandomSwaps(pool, user, 3);
        await pool.connect(user).burn(tickLower, tickUpper - tickSpacing, PRECISION);
        expect(await isTickCleared(tickLower)).to.be.false;
        expect(await isTickCleared(tickUpper - tickSpacing)).to.be.true;
      });

      it('will not transfer rTokens to user if position is burnt without any swap', async () => {
        let userRTokenBalanceBefore = await reinvestmentToken.balanceOf(user.address);
        await pool.connect(user).burn(tickLower, tickUpper, PRECISION.mul(BPS));
        expect(await reinvestmentToken.balanceOf(user.address)).to.be.eql(userRTokenBalanceBefore);
      });

      it('should transfer rTokens to user after swaps overlapping user position crosses a tick', async () => {
        // swap to outside user position to update feeGrowthGlobal
        await swapToUpTick(pool, user, tickUpper + 1);
        let userRTokenBalanceBefore = await reinvestmentToken.balanceOf(user.address);
        await pool.connect(user).burn(tickLower, tickUpper, PRECISION);
        expect(await reinvestmentToken.balanceOf(user.address)).to.be.gt(userRTokenBalanceBefore);
      });

      it('should not transfer any rTokens if fees collected are outside position', async () => {
        tickLower = nearestTickToPrice + 10 * tickSpacing;
        tickUpper = nearestTickToPrice + 20 * tickSpacing;
        // mint position above current tick
        await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
        // swap to below lower tick
        await swapToDownTick(pool, user, tickLower - 5);
        let userRTokenBalanceBefore = await reinvestmentToken.balanceOf(user.address);
        await pool.connect(user).burn(tickLower, tickUpper, PRECISION);
        expect(await reinvestmentToken.balanceOf(user.address)).to.be.eq(userRTokenBalanceBefore);
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
        // await pool.connect(user).burn(tickLower, tickUpper, PRECISION);
        await expect(pool.connect(user).burn(tickLower, tickUpper, PRECISION))
          .to.emit(token1, 'Transfer')
          .to.not.emit(token0, 'Transfer');
      });
    });
  });

  describe('pool liquidity updates', async () => {
    beforeEach('unlock pool at 0 tick', async () => {
      initialPrice = encodePriceSqrt(ONE, ONE);
      await callback.unlockPool(pool.address, initialPrice, '0x');
      await callback.mint(pool.address, user.address, -100 * tickSpacing, 100 * tickSpacing, PRECISION, '0x');
    });

    describe('position above current price', async () => {
      it('should increase and decrease pool liquidity when entering and exiting range', async () => {
        tickLower = 10 * tickSpacing;
        tickUpper = 20 * tickSpacing;
        await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');

        let poolLiquidityBefore = (await pool.getPoolState())._poolLiquidity;
        // enter position range
        await swapToUpTick(pool, user, tickLower);
        let poolLiquidityAfter = (await pool.getPoolState())._poolLiquidity;
        expect(poolLiquidityAfter).to.be.gt(poolLiquidityBefore);
        poolLiquidityBefore = poolLiquidityAfter;
        // exit position range
        await swapToUpTick(pool, user, tickUpper);
        expect((await pool.getPoolState())._poolLiquidity).to.be.lt(poolLiquidityBefore);
      });
    });

    describe('position within current price', async () => {
      it('should increase and decrease pool liquidity when entering and exiting range', async () => {
        tickLower = -10 * tickSpacing;
        tickUpper = 10 * tickSpacing;
        let poolLiquidityBefore = (await pool.getPoolState())._poolLiquidity;
        await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
        let poolLiquidityAfter = (await pool.getPoolState())._poolLiquidity;
        expect(poolLiquidityAfter).to.be.gt(poolLiquidityBefore);
        poolLiquidityBefore = poolLiquidityAfter;

        // exit position range
        await swapToUpTick(pool, user, tickUpper);
        poolLiquidityAfter = (await pool.getPoolState())._poolLiquidity;
        expect(poolLiquidityAfter).to.be.lt(poolLiquidityBefore);
        poolLiquidityBefore = poolLiquidityAfter;

        // enter position range
        await swapToDownTick(pool, user, tickUpper - 1);
        poolLiquidityAfter = (await pool.getPoolState())._poolLiquidity;
        expect(poolLiquidityAfter).to.be.gt(poolLiquidityBefore);
        poolLiquidityBefore = poolLiquidityAfter;

        // exit position range (lower)
        await swapToDownTick(pool, user, tickLower);
        poolLiquidityAfter = (await pool.getPoolState())._poolLiquidity;
        expect(poolLiquidityAfter).to.be.lt(poolLiquidityBefore);
        poolLiquidityBefore = poolLiquidityAfter;

        // re-enter position range (lower)
        await swapToDownTick(pool, user, tickLower - 2);
        await swapToUpTick(pool, user, tickLower);
        poolLiquidityAfter = (await pool.getPoolState())._poolLiquidity;
        expect(poolLiquidityAfter).to.be.gt(poolLiquidityBefore);
      });
    });

    describe('position below current price', async () => {
      it('should increase and decrease pool liquidity when entering and exiting range', async () => {
        tickLower = -20 * tickSpacing;
        tickUpper = -10 * tickSpacing;
        await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');

        let poolLiquidityBefore = (await pool.getPoolState())._poolLiquidity;
        // enter position range
        await swapToDownTick(pool, user, tickUpper);
        let poolLiquidityAfter = (await pool.getPoolState())._poolLiquidity;
        expect(poolLiquidityAfter).to.be.gt(poolLiquidityBefore);
        poolLiquidityBefore = poolLiquidityAfter;
        // exit position range
        await swapToDownTick(pool, user, tickLower);
        expect((await pool.getPoolState())._poolLiquidity).to.be.lt(poolLiquidityBefore);
      });
    });
  });

  describe('test swap', async () => {
    beforeEach('unlock pool with initial price of 2:1', async () => {
      initialPrice = encodePriceSqrt(TWO, ONE);
      await callback.unlockPool(pool.address, initialPrice, '0x');
      nearestTickToPrice = (await getNearestSpacedTickAtPrice(initialPrice, tickSpacing)).toNumber();
    });

    it('tests token0 exactInput (move down tick)', async () => {
      tickLower = nearestTickToPrice - 500 * tickSpacing;
      tickUpper = nearestTickToPrice + 2 * tickSpacing;
      await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION.mul(10), '0x');
      let token0BalanceBefore = await token0.balanceOf(user.address);
      let token1BalanceBefore = await token1.balanceOf(user.address);
      await logSwapState(SwapTitle.BEFORE_SWAP, pool);
      let tx = await callback.swap(pool.address, user.address, PRECISION, true, MIN_SQRT_RATIO.add(ONE), '0x');
      await snapshotGasCost(tx);
      let token0BalanceAfter = await token0.balanceOf(user.address);
      let token1BalanceAfter = await token1.balanceOf(user.address);
      await logSwapState(SwapTitle.AFTER_SWAP, pool);
      logBalanceChange(token0BalanceAfter.sub(token0BalanceBefore), token1BalanceAfter.sub(token1BalanceBefore));
    });

    it('tests token1 exactOutput (move down tick)', async () => {
      tickLower = nearestTickToPrice - 500 * tickSpacing;
      tickUpper = nearestTickToPrice + 2 * tickSpacing;
      await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION.mul(10), '0x');
      let token0BalanceBefore = await token0.balanceOf(user.address);
      let token1BalanceBefore = await token1.balanceOf(user.address);
      await logSwapState(SwapTitle.BEFORE_SWAP, pool);
      let tx = await callback.swap(
        pool.address,
        user.address,
        BN.from('-1751372543351715880'),
        false,
        MIN_SQRT_RATIO.add(ONE),
        '0x'
      );
      await snapshotGasCost(tx);
      let token0BalanceAfter = await token0.balanceOf(user.address);
      let token1BalanceAfter = await token1.balanceOf(user.address);
      await logSwapState(SwapTitle.AFTER_SWAP, pool);
      logBalanceChange(token0BalanceAfter.sub(token0BalanceBefore), token1BalanceAfter.sub(token1BalanceBefore));
    });

    it('tests token1 exactInput (move up tick)', async () => {
      tickLower = nearestTickToPrice - 2 * tickSpacing;
      tickUpper = nearestTickToPrice + 500 * tickSpacing;
      await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION.mul(10), '0x');
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
      tickLower = nearestTickToPrice - 2 * tickSpacing;
      tickUpper = nearestTickToPrice + 500 * tickSpacing;
      await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION.mul(10), '0x');
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
  });
});

async function isTickCleared(tick: number): Promise<boolean> {
  const {liquidityGross, feeGrowthOutside, liquidityNet} = await pool.ticks(tick);
  if (!feeGrowthOutside.eq(ZERO)) return false;
  if (!liquidityNet.eq(ZERO)) return false;
  if (!liquidityGross.eq(ZERO)) return false;
  return true;
}

async function doRandomSwaps(pool: ProAMMPool, user: Wallet, iterations: number, maxSwapQty?: BigNumber) {
  for (let i = 0; i < iterations; i++) {
    let isToken0 = Math.random() < 0.5;
    let isExactInput = Math.random() < 0.5;
    let swapQty = genRandomBN(ONE, maxSwapQty ? maxSwapQty : PRECISION);
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
  }
}

async function swapToUpTick(pool: ProAMMPool, user: Wallet, targetTick: number, maxSwapQty?: BigNumber) {
  while ((await pool.getPoolState())._poolTick < targetTick) {
    // either specify exactInputToken1 or exactOutputToken0
    let isToken0 = Math.random() < 0.5;
    let isExactInput = !isToken0;
    let swapQty = genRandomBN(ONE, maxSwapQty ? maxSwapQty : PRECISION.mul(BPS));
    if (!isExactInput) {
      let token = isToken0 ? token0 : token1;
      let poolBal = await token.balanceOf(pool.address);
      if (swapQty.gt(poolBal)) swapQty = genRandomBN(ONE, poolBal);
      swapQty = swapQty.mul(-1);
    }
    await callback
      .connect(user)
      .swap(pool.address, user.address, swapQty, isToken0, await getPriceFromTick(targetTick), '0x');
  }
}

async function swapToDownTick(pool: ProAMMPool, user: Wallet, targetTick: number, maxSwapQty?: BigNumber) {
  while ((await pool.getPoolState())._poolTick > targetTick) {
    // either specify exactInputToken0 or exactOutputToken1
    let isToken0 = Math.random() < 0.5;
    let isExactInput = isToken0;
    let swapQty = genRandomBN(ONE, maxSwapQty ? maxSwapQty : PRECISION.mul(BPS));
    if (!isExactInput) {
      let token = isToken0 ? token0 : token1;
      let poolBal = await token.balanceOf(pool.address);
      if (swapQty.gt(poolBal)) swapQty = genRandomBN(ONE, poolBal);
      swapQty = swapQty.mul(-1);
    }
    await callback
      .connect(user)
      .swap(pool.address, user.address, swapQty, isToken0, await getPriceFromTick(targetTick), '0x');
  }
}
