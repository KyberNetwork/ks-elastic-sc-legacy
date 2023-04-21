import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {BigNumber as BN} from 'ethers';
import chai from 'chai';
const {solidity, loadFixture} = waffle;
chai.use(solidity);

import {
  MockFactory,
  MockPool,
  MockToken,
  MockTokenV2,
  MockTokenV3,
  MockToken__factory,
  MockTokenV2__factory,
  MockTokenV3__factory,
  MockPool__factory,
} from '../typechain';
import {QuoterV2, QuoterV2__factory, MockCallbacks, MockCallbacks__factory} from '../typechain';

import {MIN_LIQUIDITY, MIN_TICK, MAX_TICK, MIN_SQRT_RATIO, MAX_SQRT_RATIO, FEE_UNITS} from './helpers/helper';
import {ZERO_ADDRESS, ZERO, ONE, MAX_UINT, PRECISION, TWO, BPS, NEGATIVE_ONE} from './helpers/helper';
import {deployMockFactory, getTicksPrevious} from './helpers/setup';
import {genRandomBN} from './helpers/genRandomBN';
import {logBalanceChange, logSwapState, SwapTitle} from './helpers/logger';
import {encodePriceSqrt, getMaxTick, getMinTick, getNearestSpacedTickAtPrice} from './helpers/utils';
import {getPriceFromTick, snapshotGasCost} from './helpers/utils';

let factory: MockFactory;
let token0: MockToken | MockTokenV2 | MockTokenV3;
let token1: MockToken | MockTokenV2 | MockTokenV3;
let token2: MockToken | MockTokenV2 | MockTokenV3;
let token3: MockToken | MockTokenV2 | MockTokenV3;
let token4: MockToken | MockTokenV2 | MockTokenV3;
let token5: MockToken | MockTokenV2 | MockTokenV3;
let quoter: QuoterV2;
let poolBalToken0: BN;
let poolBalToken1: BN;
let poolArray: MockPool[] = [];
let pool1: MockPool;
let pool2: MockPool;
let pool3: MockPool;
let callback1: MockCallbacks;
let callback2: MockCallbacks;
let callback3: MockCallbacks;
let swapFeeUnitsArray = [50, 300];
let swapFeeUnits = swapFeeUnitsArray[0];
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
  constructor(
    public factory: MockFactory,
    public poolArray: MockPool[],
    public token0: MockToken | MockTokenV2 | MockTokenV3,
    public token1: MockToken | MockTokenV2 | MockTokenV3,
    public token2: MockToken | MockTokenV2 | MockTokenV3,
    public token3: MockToken | MockTokenV2 | MockTokenV3,
    public token4: MockToken | MockTokenV2 | MockTokenV3,
    public token5: MockToken | MockTokenV2 | MockTokenV3,
    public callback1: MockCallbacks,
    public callback2: MockCallbacks,
    public callback3: MockCallbacks,
    public quoter: QuoterV2
  ) {}
}

describe('Pool', () => {
  const [user, admin, configMaster] = waffle.provider.getWallets();

  async function fixture(): Promise<Fixtures> {
    let factory = await deployMockFactory(admin, vestingPeriod);
    const PoolContract = (await ethers.getContractFactory('MockPool')) as MockPool__factory;

    await factory.connect(admin).enableSwapFee(swapFeeUnits, tickDistance);

    const MockTokenContract = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    const tokenA = await MockTokenContract.deploy('KNC', 'KNC', PRECISION.mul(PRECISION));

    const MockTokenContractDecimal6 = (await ethers.getContractFactory('MockTokenV3')) as MockTokenV3__factory;
    const tokenB = await MockTokenContractDecimal6.deploy('USDC', 'USDC', PRECISION.mul(PRECISION));

    const MockTokenContractDecimal2 = (await ethers.getContractFactory('MockTokenV2')) as MockTokenV2__factory;
    const tokenC = await MockTokenContractDecimal2.deploy('TKA', 'TKA', PRECISION.mul(PRECISION));

    if (tokenA.address.toLowerCase() < tokenC.address.toLowerCase()) {
      token0 = tokenA;
      token1 = tokenC;
    } else {
      token0 = tokenC;
      token1 = tokenA;
    }

    if (tokenA.address.toLowerCase() < tokenB.address.toLowerCase()) {
      token2 = tokenA;
      token3 = tokenB;
    } else {
      token2 = tokenB;
      token3 = tokenA;
    }

    if (tokenB.address.toLowerCase() < tokenC.address.toLowerCase()) {
      token4 = tokenB;
      token5 = tokenC;
    } else {
      token4 = tokenC;
      token5 = tokenB;
    }

    // create pools
    let poolArray = [];

    await factory.createPool(token0.address, token1.address, swapFeeUnits);
    const poolAddress1 = await factory.getPool(token0.address, token1.address, swapFeeUnits);

    await factory.createPool(token2.address, token3.address, swapFeeUnits);
    const poolAddress2 = await factory.getPool(token2.address, token3.address, swapFeeUnits);

    await factory.createPool(token4.address, token5.address, swapFeeUnits);
    const poolAddress3 = await factory.getPool(token4.address, token5.address, swapFeeUnits);

    poolArray.push(PoolContract.attach(poolAddress1));
    poolArray.push(PoolContract.attach(poolAddress2));
    poolArray.push(PoolContract.attach(poolAddress3));

    const CallbackContract = (await ethers.getContractFactory('MockCallbacks')) as MockCallbacks__factory;

    callback1 = await CallbackContract.deploy(token0.address, token1.address);
    callback2 = await CallbackContract.deploy(token2.address, token3.address);
    callback3 = await CallbackContract.deploy(token4.address, token5.address);

    // user give token approval to callbacks
    await tokenA.connect(user).approve(callback1.address, MAX_UINT);
    await tokenB.connect(user).approve(callback1.address, MAX_UINT);
    await tokenC.connect(user).approve(callback1.address, MAX_UINT);

    await tokenA.connect(user).approve(callback2.address, MAX_UINT);
    await tokenB.connect(user).approve(callback2.address, MAX_UINT);
    await tokenC.connect(user).approve(callback2.address, MAX_UINT);

    await tokenA.connect(user).approve(callback3.address, MAX_UINT);
    await tokenB.connect(user).approve(callback3.address, MAX_UINT);
    await tokenC.connect(user).approve(callback3.address, MAX_UINT);

    const QuoterV2Contract = (await ethers.getContractFactory('QuoterV2')) as QuoterV2__factory;
    let quoter = await QuoterV2Contract.deploy(factory.address);

    return new Fixtures(
      factory,
      poolArray,
      token0,
      token1,
      token2,
      token3,
      token4,
      token5,
      callback1,
      callback2,
      callback3,
      quoter
    );
  }

  beforeEach('load fixture', async () => {
    ({factory, poolArray, token0, token1, token2, token3, token4, token5, callback1, callback2, callback3, quoter} =
      await loadFixture(fixture));
    pool1 = poolArray[0];
    pool2 = poolArray[1];
    pool3 = poolArray[2];
  });

  describe('#unlockPool', async () => {
    it('should unlockPool with tokens decimal 2-18, tick 10', async () => {
      initialPrice = await getPriceFromTick(10);

      let balanceToken0Before = await token0.balanceOf(user.address);
      let balanceToken1Before = await token1.balanceOf(user.address);

      await callback1.connect(user).unlockPool(pool1.address, initialPrice);

      let balanceToken0After = await token0.balanceOf(user.address);
      let balanceToken1After = await token1.balanceOf(user.address);

      expect(balanceToken0After.sub(balanceToken0Before).toString()).to.be.equals('-100');
      expect(balanceToken1After.sub(balanceToken1Before).toString()).to.be.equals('-101');
    });

    it('should unlockPool with tokens decimal 2-18, min tick', async () => {
      initialPrice = await getPriceFromTick(MIN_TICK);

      let balanceToken0Before = await token0.balanceOf(user.address);
      let balanceToken1Before = await token1.balanceOf(user.address);

      await callback1.connect(user).unlockPool(pool1.address, initialPrice);

      let balanceToken0After = await token0.balanceOf(user.address);
      let balanceToken1After = await token1.balanceOf(user.address);

      expect(balanceToken0After.sub(balanceToken0Before).toString()).to.be.equals('-1844605070736724606325');
      expect(balanceToken1After.sub(balanceToken1Before).toString()).to.be.equals('-1');
    });

    it('should unlockPool with tokens decimal 2-18, max tick', async () => {
      initialPrice = await getPriceFromTick(MAX_TICK.sub(BN.from(1))); // not accepted MAX_TICK price so we gonna subtract it by 1

      let balanceToken0Before = await token0.balanceOf(user.address);
      let balanceToken1Before = await token1.balanceOf(user.address);

      await callback1.connect(user).unlockPool(pool1.address, initialPrice);

      let balanceToken0After = await token0.balanceOf(user.address);
      let balanceToken1After = await token1.balanceOf(user.address);

      expect(balanceToken0After.sub(balanceToken0Before).toString()).to.be.equals('-1');
      expect(balanceToken1After.sub(balanceToken1Before).toString()).to.be.equals('-1844512847772907492515');
    });

    it('should unlockPool with tokens decimal 6-18, tick 10', async () => {
      initialPrice = await getPriceFromTick(10);

      let balanceToken0Before = await token2.balanceOf(user.address);
      let balanceToken1Before = await token3.balanceOf(user.address);

      await callback2.connect(user).unlockPool(pool2.address, initialPrice);

      let balanceToken0After = await token2.balanceOf(user.address);
      let balanceToken1After = await token3.balanceOf(user.address);

      expect(balanceToken0After.sub(balanceToken0Before).toString()).to.be.equals('-100');
      expect(balanceToken1After.sub(balanceToken1Before).toString()).to.be.equals('-101');
    });

    it('should unlockPool with tokens decimal 6-18, min tick', async () => {
      initialPrice = await getPriceFromTick(MIN_TICK);

      let balanceToken0Before = await token2.balanceOf(user.address);
      let balanceToken1Before = await token3.balanceOf(user.address);

      await callback2.connect(user).unlockPool(pool2.address, initialPrice);

      let balanceToken0After = await token2.balanceOf(user.address);
      let balanceToken1After = await token3.balanceOf(user.address);

      expect(balanceToken0After.sub(balanceToken0Before).toString()).to.be.equals('-1844605070736724606325');
      expect(balanceToken1After.sub(balanceToken1Before).toString()).to.be.equals('-1');
    });

    it('should unlockPool with tokens decimal 6-18, max tick', async () => {
      initialPrice = await getPriceFromTick(MAX_TICK.sub(BN.from(1))); // not accepted MAX_TICK price so we gonna subtract it by 1

      let balanceToken0Before = await token2.balanceOf(user.address);
      let balanceToken1Before = await token3.balanceOf(user.address);

      await callback2.connect(user).unlockPool(pool2.address, initialPrice);

      let balanceToken0After = await token2.balanceOf(user.address);
      let balanceToken1After = await token3.balanceOf(user.address);

      expect(balanceToken0After.sub(balanceToken0Before).toString()).to.be.equals('-1');
      expect(balanceToken1After.sub(balanceToken1Before).toString()).to.be.equals('-1844512847772907492515');
    });

    it('should unlockPool with tokens decimal 2-6, tick 10', async () => {
      initialPrice = await getPriceFromTick(10);

      let balanceToken0Before = await token4.balanceOf(user.address);
      let balanceToken1Before = await token5.balanceOf(user.address);

      await callback3.connect(user).unlockPool(pool3.address, initialPrice);

      let balanceToken0After = await token4.balanceOf(user.address);
      let balanceToken1After = await token5.balanceOf(user.address);

      expect(balanceToken0After.sub(balanceToken0Before).toString()).to.be.equals('-100');
      expect(balanceToken1After.sub(balanceToken1Before).toString()).to.be.equals('-101');
    });

    it('should unlockPool with tokens decimal 2-6, min tick', async () => {
      initialPrice = await getPriceFromTick(MIN_TICK);

      let balanceToken0Before = await token4.balanceOf(user.address);
      let balanceToken1Before = await token5.balanceOf(user.address);

      await callback3.connect(user).unlockPool(pool3.address, initialPrice);

      let balanceToken0After = await token4.balanceOf(user.address);
      let balanceToken1After = await token5.balanceOf(user.address);

      expect(balanceToken0After.sub(balanceToken0Before).toString()).to.be.equals('-1844605070736724606325');
      expect(balanceToken1After.sub(balanceToken1Before).toString()).to.be.equals('-1');
    });

    it('should unlockPool with tokens decimal 2-6, max tick', async () => {
      initialPrice = await getPriceFromTick(MAX_TICK.sub(BN.from(1))); // not accepted MAX_TICK price so we gonna subtract it by 1

      let balanceToken0Before = await token4.balanceOf(user.address);
      let balanceToken1Before = await token5.balanceOf(user.address);

      await callback3.connect(user).unlockPool(pool3.address, initialPrice);

      let balanceToken0After = await token4.balanceOf(user.address);
      let balanceToken1After = await token5.balanceOf(user.address);

      expect(balanceToken0After.sub(balanceToken0Before).toString()).to.be.equals('-1');
      expect(balanceToken1After.sub(balanceToken1Before).toString()).to.be.equals('-1844512847772907492515');
    });
  });
});
