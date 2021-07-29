import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {
  BN,
  PRECISION,
  ZERO_ADDRESS,
  ZERO,
  ONE,
  MAX_UINT,
  TWO_POW_96,
  MIN_LIQUIDITY,
  MIN_TICK,
  MAX_TICK,
  MIN_SQRT_RATIO,
  MAX_SQRT_RATIO,
  TWO,
  BPS,
} from './helpers/helper';
import chai from 'chai';
const {solidity, loadFixture} = waffle;
chai.use(solidity);

import {ProAMMFactory, ProAMMPool, MockToken, MockToken__factory, MockProAMMCallbacks} from '../typechain';
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

let Token: MockToken__factory;
let factory: ProAMMFactory;
let tokenA: MockToken;
let tokenB: MockToken;
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

describe('ProAMMPool', () => {
  const [user, admin, feeToSetter] = waffle.provider.getWallets();

  async function fixture() {
    let factory = await deployFactory(ethers, admin, ZERO_ADDRESS, ZERO_ADDRESS);
    // add any newly defined tickSpacing apart from default ones
    for (let i = 0; i < swapFeeBpsArray.length; i++) {
      if ((await factory.feeAmountTickSpacing(swapFeeBpsArray[i])) == 0) {
        await factory.connect(admin).enableSwapFee(swapFeeBpsArray[i], tickSpacingArray[i]);
      }
    }
    // create pools
    let poolArray = [];
    for (let i = 0; i < swapFeeBpsArray.length; i++) {
      await factory.createPool(tokenA.address, tokenB.address, swapFeeBpsArray[i]);
      pool = (await ethers.getContractAt(
        'ProAMMPool',
        await factory.getPool(tokenA.address, tokenB.address, swapFeeBpsArray[i])
      )) as ProAMMPool;
      poolArray.push(pool);
    }
    return {factory, poolArray};
  }

  before('token and callback setup', async () => {
    Token = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    tokenA = await Token.deploy('USDC', 'USDC', PRECISION.mul(PRECISION));
    tokenB = await Token.deploy('DAI', 'DAI', PRECISION.mul(PRECISION));
    token0 = tokenA.address.toLowerCase() < tokenB.address.toLowerCase() ? tokenA : tokenB;
    token1 = token0.address == tokenA.address ? tokenB : tokenA;

    let Callback = await ethers.getContractFactory('MockProAMMCallbacks');
    callback = (await Callback.deploy(tokenA.address, tokenB.address)) as MockProAMMCallbacks;
    // user give token approval to callbacks
    await tokenA.connect(user).approve(callback.address, MAX_UINT);
    await tokenB.connect(user).approve(callback.address, MAX_UINT);
  });

  beforeEach('load fixture', async () => {
    ({factory, poolArray} = await loadFixture(fixture));
    pool = poolArray[0];
  });

  describe('#test pool deployment and initialization', async () => {
    it('should have initialized required settings', async () => {
      expect(await pool.factory()).to.be.eql(factory.address);
      let token0Address = tokenA.address < tokenB.address ? tokenA.address : tokenB.address;
      let token1Address = token0Address == tokenA.address ? tokenB.address : tokenA.address;
      expect(await pool.token0()).to.be.eql(token0Address);
      expect(await pool.token1()).to.be.eql(token1Address);
      expect(await pool.swapFeeBps()).to.be.eql(swapFeeBps);
      expect(await pool.tickSpacing()).to.be.eql(tickSpacing);
      expect(await pool.maxLiquidityPerTick()).to.be.gt(ZERO);
    });

    it('should be unable to call initialize() on the pool again', async () => {
      await expect(
        pool.initialize(factory.address, tokenA.address, tokenB.address, swapFeeBps, tickSpacing)
      ).to.be.revertedWith('already inited');
      await expect(
        pool.initialize(ZERO_ADDRESS, tokenA.address, tokenB.address, swapFeeBps, tickSpacing)
      ).to.be.revertedWith('already inited');
    });

    it('pool creation should be unaffected by poolMaster configuration', async () => {
      pool = (await ethers.getContractAt('ProAMMPool', await factory.poolMaster())) as ProAMMPool;
      // init poolMaster
      await pool.initialize(factory.address, tokenA.address, tokenB.address, swapFeeBps, tickSpacing);
      // init new tickSpacing that is not in array
      swapFeeBps = 101;
      tickSpacing = 10;
      await factory.connect(admin).enableSwapFee(swapFeeBps, tickSpacing);

      // should still be able to create pool even though poolMaster was inited
      await factory.createPool(tokenA.address, tokenB.address, swapFeeBps);
      // verify address not null
      expect(await factory.getPool(tokenA.address, tokenB.address, swapFeeBps)).to.not.eql(ZERO_ADDRESS);
      // reset swapFeeBps
      swapFeeBps = swapFeeBpsArray[0];
    });
  });

  describe('#unlockPool', async () => {
    before('set initial price', async () => {
      initialPrice = await getPriceFromTick(10);
    });

    it('should only be able to call unlockPool once', async () => {
      await callback.connect(user).unlockPool(pool.address, initialPrice, user.address, 0, 100, PRECISION, '0x');

      await expect(
        callback.unlockPool(pool.address, initialPrice, user.address, 0, 100, PRECISION, '0x')
      ).to.be.revertedWith('already inited');
    });

    it('should fail if initial tick is outside of liquidity position', async () => {
      // initial tick < lower tick
      await expect(
        callback.unlockPool(pool.address, await getPriceFromTick(-1), user.address, 0, 100, PRECISION, '0x')
      ).to.be.revertedWith('price not in range');
      // initial tick > upper tick
      await expect(
        callback.unlockPool(pool.address, await getPriceFromTick(110), user.address, 0, 100, PRECISION, '0x')
      ).to.be.revertedWith('price not in range');
    });

    it('should fail for 0 qty', async () => {
      await expect(
        callback.unlockPool(pool.address, initialPrice, user.address, 0, 100, ZERO, '0x')
      ).to.be.revertedWith('0 qty');
    });

    it('should fail to mint liquidity if callback fails to send enough qty to pool', async () => {
      // send insufficient token0
      await expect(
        callback.badUnlockPool(pool.address, initialPrice, user.address, 0, 100, PRECISION, true, false)
      ).to.be.revertedWith('lacking qty0');

      // send insufficient token1
      await expect(
        callback.badUnlockPool(pool.address, initialPrice, user.address, 0, 100, PRECISION, false, true)
      ).to.be.revertedWith('lacking qty1');
    });

    it('should have initialized the pool and created first position', async () => {
      await callback.connect(user).unlockPool(pool.address, initialPrice, user.address, 0, 100, PRECISION, '0x');

      result = await pool.getPoolState();
      expect(result._poolSqrtPrice).to.be.eql(initialPrice);
      expect(result._poolTick).to.be.eql(10);
      expect(result._locked).to.be.false;
      let expectedLiquidity = PRECISION.sub(MIN_LIQUIDITY);
      expect(result._poolLiquidity).to.be.eql(expectedLiquidity);

      result = await pool.getReinvestmentState();
      // initial feeGrowthGlobal
      // = rMintQty * TWO_POW_96 / liquidityDelta
      // = MINIMUM_LIQUIDITY * TWO_POW_96 / (PRECISION.sub(MIN_LIQUIDITY))
      let expectedFeeGrowth = MIN_LIQUIDITY.mul(TWO_POW_96).div(expectedLiquidity);
      expect(result._poolFeeGrowthGlobal).to.be.eql(expectedFeeGrowth);
      expect(result._poolReinvestmentLiquidity).to.be.eql(MIN_LIQUIDITY);
      expect(result._poolReinvestmentLiquidityLast).to.be.eql(MIN_LIQUIDITY);

      expect(await pool.reinvestmentToken()).to.not.be.eql(ZERO_ADDRESS);

      // check position updated
      result = await pool.positions(getPositionKey(user.address, 0, 100));
      expect(result.liquidity).to.be.eql(expectedLiquidity);
      expect(result.feeGrowthInsideLast).to.be.eql(expectedFeeGrowth);

      // check ticks flipped
      expect((await pool.ticks(0)).liquidityGross).to.be.eql(expectedLiquidity);
      expect((await pool.ticks(100)).liquidityGross).to.be.eql(expectedLiquidity);
    });

    it('should have emitted Initialize and Mint events', async () => {
      await expect(
        callback.connect(user).unlockPool(pool.address, initialPrice, user.address, 0, 100, PRECISION, '0x')
      )
        .to.emit(pool, 'Initialize')
        .withArgs(initialPrice, 10)
        .to.emit(pool, 'Mint')
        .withArgs(
          callback.address,
          user.address,
          0,
          100,
          PRECISION.sub(MIN_LIQUIDITY),
          4487422035756095,
          500100010000501
        );
    });

    it('should init if initial tick is equal to the lower tick', async () => {
      // initial tick = lower tick
      await expect(callback.unlockPool(pool.address, await getPriceFromTick(0), user.address, 0, 100, PRECISION, '0x'))
        .to.not.be.reverted;
    });

    it('should init if initial tick is equal to the upper tick', async () => {
      // initial tick = upper tick
      await expect(
        callback.unlockPool(pool.address, await getPriceFromTick(100), user.address, 0, 100, PRECISION, '0x')
      ).to.not.be.reverted;
    });

    it('should init if initial tick is equal to MIN_TICK (MIN_SQRT_RATIO)', async () => {
      // create new pool with tickSpacing of 4
      // so that MIN_TICK and MAX_TICK can be used as a position
      await factory.connect(admin).enableSwapFee(4, 4);
      await factory.createPool(tokenA.address, tokenB.address, 4);
      pool = (await ethers.getContractAt(
        'ProAMMPool',
        await factory.getPool(tokenA.address, tokenB.address, 4)
      )) as ProAMMPool;

      // initial price = MIN_SQRT_RATIO
      await callback.unlockPool(
        pool.address,
        MIN_SQRT_RATIO,
        user.address,
        MIN_TICK,
        MIN_TICK.add(100),
        PRECISION,
        '0x'
      );
    });

    it('should fail if initial tick is equal to MAX_TICK (MAX_SQRT_RATIO)', async () => {
      // initial price = MAX_SQRT_RATIO
      await expect(
        callback.unlockPool(
          pool.address,
          MAX_SQRT_RATIO,
          user.address,
          MAX_TICK.sub(100),
          MAX_TICK,
          MIN_LIQUIDITY.mul(2),
          '0x'
        )
      ).to.be.revertedWith('R');
    });

    it('should init if initial price is equal to MAX_SQRT_RATIO - 1', async () => {
      // create new pool with tickSpacing of 4
      // so that MIN_TICK and MAX_TICK can be used as a position
      await factory.connect(admin).enableSwapFee(4, 4);
      await factory.createPool(tokenA.address, tokenB.address, 4);
      pool = (await ethers.getContractAt(
        'ProAMMPool',
        await factory.getPool(tokenA.address, tokenB.address, 4)
      )) as ProAMMPool;

      // initial price = MAX_SQRT_RATIO - 1
      await callback.unlockPool(
        pool.address,
        MAX_SQRT_RATIO.sub(ONE),
        user.address,
        MAX_TICK.sub(100),
        MAX_TICK,
        MIN_LIQUIDITY.mul(2),
        '0x'
      );
    });
  });

  describe('#mint', async () => {
    it('should fail if pool is not unlocked', async () => {
      await expect(callback.mint(pool.address, user.address, 0, 100, PRECISION, '0x')).to.be.revertedWith('locked');
    });

    describe('after unlockPool', async () => {
      beforeEach('unlock pool with initial price of 2:1', async () => {
        await callback.unlockPool(
          pool.address,
          encodePriceSqrt(TWO, ONE),
          user.address,
          minTick,
          maxTick,
          MIN_LIQUIDITY.mul(TWO),
          '0x'
        );
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
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            positionData = await pool.positions(positionKey);
            expect(positionData.liquidity).to.be.eql(PRECISION);
            // no swap, no fees
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
            // do swaps to cross into position
            await swapToUpTick(pool, user, tickUpper);
            // add on more liquidity
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
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
            expect(tickLowerData.feeGrowthOutside).to.be.gt(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.eql(ZERO);
          });

          it('should not change initialized ticks status or update feeGrowthOutside for liquidity addition', async () => {
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            let feeGrowthOutsideTickLower = (await pool.ticks(tickLower)).feeGrowthOutside;
            expect(feeGrowthOutsideTickLower).to.be.gt(ZERO);
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
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            positionData = await pool.positions(positionKey);
            expect(positionData.liquidity).to.be.eql(PRECISION);
            // no swap, no fees
            expect(positionData.feeGrowthInsideLast).to.be.eql(ZERO);
            // do a few swaps, since price is in position, direction doesnt matter
            await doRandomSwaps(pool, user, 3);
            // add on more liquidity
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
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
            expect(tickLowerData.feeGrowthOutside).to.be.gt(ZERO);
            expect(tickUpperData.feeGrowthOutside).to.be.gt(ZERO);
          });

          it('should not change initialized ticks status or update feeGrowthOutside for liquidity addition', async () => {
            // mint new position
            await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
            let feeGrowthOutside = (await pool.ticks(tickLower)).feeGrowthOutside;
            expect(feeGrowthOutside).to.be.gt(ZERO);
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
      beforeEach('unlock pool with initial price of 2:1, init reinvestment token', async () => {
        initialPrice = encodePriceSqrt(TWO, ONE);
        nearestTickToPrice = (await getNearestSpacedTickAtPrice(initialPrice, tickSpacing)).toNumber();
        tickLower = nearestTickToPrice - 10 * tickSpacing;
        tickUpper = nearestTickToPrice + 10 * tickSpacing;
        await callback.unlockPool(
          pool.address,
          encodePriceSqrt(TWO, ONE),
          user.address,
          tickLower,
          tickUpper,
          PRECISION.add(MIN_LIQUIDITY),
          '0x'
        );
        reinvestmentToken = (await ethers.getContractAt(
          'IReinvestmentToken',
          await pool.reinvestmentToken()
        )) as MockToken;
      });

      it('should fail burning more than position liquidity', async () => {
        await expect(pool.connect(user).burn(tickLower, tickUpper, PRECISION.add(ONE))).to.be.reverted;
      });

      it('should retain fee growth position snapshot after all user liquidity is removed', async () => {
        await doRandomSwaps(pool, user, 3, BPS);
        await pool.connect(user).burn(tickLower, tickUpper, PRECISION);
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
        await doRandomSwaps(pool, user, 1, BPS);
        await pool.connect(user).burn(tickLower + tickSpacing, tickUpper - tickSpacing, PRECISION);
        expect(await isTickCleared(tickLower + tickSpacing)).to.be.true;
        expect(await isTickCleared(tickUpper - tickSpacing)).to.be.true;
      });

      it('should clear only lower tick if upper remains used', async () => {
        await callback.mint(pool.address, user.address, tickLower + tickSpacing, tickUpper, PRECISION, '0x');
        await doRandomSwaps(pool, user, 1);
        await pool.connect(user).burn(tickLower + tickSpacing, tickUpper, PRECISION);
        expect(await isTickCleared(tickLower + tickSpacing)).to.be.true;
        expect(await isTickCleared(tickUpper)).to.be.false;
      });

      it('should clear only upper tick if lower remains used', async () => {
        await callback.mint(pool.address, user.address, tickLower, tickUpper - tickSpacing, PRECISION, '0x');
        await doRandomSwaps(pool, user, 1);
        await pool.connect(user).burn(tickLower, tickUpper - tickSpacing, PRECISION);
        expect(await isTickCleared(tickLower)).to.be.false;
        expect(await isTickCleared(tickUpper - tickSpacing)).to.be.true;
      });

      it('should transfer rTokens to user if there is fee collected within position', async () => {
        await doRandomSwaps(pool, user, 3);
        let userRTokenBalanceBefore = await reinvestmentToken.balanceOf(user.address);
        await pool.connect(user).burn(tickLower, tickUpper, PRECISION);
        expect(await reinvestmentToken.balanceOf(user.address)).to.be.gt(userRTokenBalanceBefore);
      });

      it('should not transfer any rTokens if fees collected are outside position', async () => {
        tickLower = nearestTickToPrice + 10 * tickSpacing;
        tickUpper = nearestTickToPrice + 20 * tickSpacing;
        // mint position above current tick
        await callback.mint(pool.address, user.address, tickLower, tickUpper, PRECISION, '0x');
        // swap to below tick
        await swapToDownTick(pool, user, tickLower - 5);
        let userRTokenBalanceBefore = await reinvestmentToken.balanceOf(user.address);
        await pool.connect(user).burn(tickLower, tickUpper, PRECISION);
        expect(await reinvestmentToken.balanceOf(user.address)).to.be.eq(userRTokenBalanceBefore);
      });
    });
  });

  // TODO: for initial gas profiling, remove when more robust tests have been added
  describe('mint and swap to get gas costs', async () => {
    beforeEach('load fixture', async () => {
      ({factory, poolArray} = await loadFixture(fixture));
    });

    it('should be able to mint liquidity and do swap', async () => {
      for (let i = 0; i < poolArray.length; i++) {
        pool = poolArray[i];
        await callback
          .connect(user)
          .unlockPool(
            pool.address,
            BN.from('79704936542881920863903188246'),
            user.address,
            tickSpacingArray[i],
            100 * tickSpacingArray[i],
            PRECISION,
            '0x'
          );
        await callback
          .connect(user)
          .swap(pool.address, user.address, PRECISION.div(100000), true, BN.from('4295128740'), '0x');
      }
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
