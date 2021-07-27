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
} from './helpers/helper';
import chai from 'chai';
const {solidity, loadFixture} = waffle;
chai.use(solidity);

import {ProAMMFactory, ProAMMPool, MockToken, MockToken__factory, MockProAMMCallbacks} from '../typechain';
import {deployFactory} from './helpers/proAMMSetup';
import {
  BigNumber,
  encodePriceSqrt,
  getNearestSpacedTickAtPrice,
  getPositionKey,
  getPriceFromTick
} from './helpers/utils';

let Token: MockToken__factory;
let factory: ProAMMFactory;
let tokenA: MockToken;
let tokenB: MockToken;
let poolArray: ProAMMPool[] = [];
let pool: ProAMMPool;
let callback: MockProAMMCallbacks;
let swapFeeBpsArray = [5, 30];
let swapFeeBps = swapFeeBpsArray[0];
let tickSpacingArray = [10, 60];
let tickSpacing = tickSpacingArray[0];
let initialPrice: BigNumber;
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
      ).to.be.revertedWith('price !in range');
      // initial tick > upper tick
      await expect(
        callback.unlockPool(pool.address, await getPriceFromTick(110), user.address, 0, 100, PRECISION, '0x')
      ).to.be.revertedWith('price !in range');
    });

    it('should fail for 0 qty', async () => {
      await expect(
        callback.unlockPool(pool.address, initialPrice, user.address, 0, 100, ZERO, '0x')
      ).to.be.revertedWith('zero qty');
    });

    it('should fail to mint liquidity if callback fails to send enough qty to pool', async () => {
      // send insufficient token0
      await expect(
        callback.badUnlockPool(pool.address, initialPrice, user.address, 0, 100, PRECISION, true, false)
      ).to.be.revertedWith('lacking qty0');

      // send insufficient token1
      await expect(
        callback.badUnlockPool(pool.address, await initialPrice, user.address, 0, 100, PRECISION, false, true)
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
          4487422035756091,
          500100010000500
        );
    });

    it('should init if initial tick is equal to the lower tick', async () => {
      // initial tick = lower tick
      callback.unlockPool(pool.address, await getPriceFromTick(0), user.address, 0, 100, PRECISION, '0x');
    });

    it('should init if initial tick is equal to the upper tick', async () => {
      // initial tick = upper tick
      callback.unlockPool(pool.address, await getPriceFromTick(100), user.address, 0, 100, PRECISION, '0x');
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
        let middleTick = await getNearestSpacedTickAtPrice(encodePriceSqrt(TWO, ONE), tickSpacing);
        await callback.unlockPool(
          pool.address,
          encodePriceSqrt(TWO, ONE),
          user.address,
          middleTick.sub(10000),
          middleTick.add(10000),
          PRECISION,
          '0x'
        );
      });

      it('should fail if ticks are not in tick spacing', async () => {});

      it('should fail if liquidity added exceeds maxLiquidityPerTick', async () => {
        await expect(
          callback.mint(pool.address, user.address, 0, 10, (await pool.maxLiquidityPerTick()).mul(10), '0x')
        ).to.be.revertedWith('> max liquidity');
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
