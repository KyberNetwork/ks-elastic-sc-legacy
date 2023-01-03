import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {Wallet, BigNumber, ContractTransaction} from 'ethers';
import {ZERO, BN, MAX_TICK, MIN_TICK, ONE, NEGATIVE_ONE, BPS, PRECISION, MAX_UINT} from '../helpers/helper';
import chai from 'chai';
const {solidity, loadFixture} = waffle;
chai.use(solidity);

import {
  MockToken,
  MockToken__factory,
  BasePositionManager,
  BasePositionManager__factory,
  Router__factory,
  Router,
  Factory,
  Pool,
  MockTokenPositionDescriptor__factory,
  MockSimplePoolStorage,
  MockSimplePoolStorage__factory,
  TicksFeesReader,
  TicksFeesReader__factory,
  MockWeth__factory,
} from '../../typechain';
import {BigNumberish} from '@ethersproject/bignumber';
import {genRandomBN} from '../helpers/genRandomBN';
import {deployFactory} from '../helpers/setup';
import {encodePriceSqrt, sortTokens} from '../helpers/utils';

let shortTickDistance = 100;
let longTickDistance = 10000;
let unloadedSimplePoolStorage: MockSimplePoolStorage;
let loadedSimplePoolStorageShort: MockSimplePoolStorage;
let loadedSimplePoolStorageLong: MockSimplePoolStorage;
let ticksFeesReader: TicksFeesReader;
let token0: MockToken;
let token1: MockToken;
let ticksPrevious: [BigNumber, BigNumber] = [MIN_TICK, MIN_TICK];
let factory: Factory;
let router: Router;
let pool: string;
let positionManager: BasePositionManager;
let initialPrice: BigNumber;
let nextTokenId: BigNumber;
let outRangeTokenId: BigNumber;
let positionLowerTick = -1000;
let positionUpperTick = 1000;
let swapFee = 40;

function genMaxInitTicks(tickDistance: number) {
  let resultArr = [...Array(MAX_TICK.toNumber()).keys()].filter((x) => x % tickDistance == 0);
  let reversed = resultArr.slice().reverse();
  reversed.pop(); // remove duplicate 0
  reversed = reversed.map((x) => -x);
  return reversed.concat(resultArr);
}

function genRandomInitTicks(tickDistance: number) {
  let resultArr = genMaxInitTicks(tickDistance);
  // random number of elements to remove that is less than array length
  let numItemsToRemove = genRandomBN(ONE, BN.from(resultArr.length - 1)).toNumber();
  for (let i = numItemsToRemove; i >= 0; i--) {
    resultArr.splice(Math.floor(Math.random() * resultArr.length), 1);
  }
  return resultArr;
}

// note: doesnt compare array length
// will only compare elements in first array to match that of the second
// if second array has extra elements, they are ignored
function verifyArrays(firstArr: BigNumberish[], secondArr: BigNumberish[]) {
  for (let i = 0; i < firstArr.length; i++) {
    expect(firstArr[i]).to.be.eq(secondArr[i]);
  }
}

async function insertTicksByParts(mockSimplePoolStorage: MockSimplePoolStorage, arr: BigNumberish[]) {
  let i = 0;
  while (i < arr.length) {
    await mockSimplePoolStorage.insertTicks(arr.slice(i, i + 500));
    i += 500;
  }
}

class Fixtures {
  constructor(
    public unloadedSimplePoolStorage: MockSimplePoolStorage,
    public loadedSimplePoolStorageShort: MockSimplePoolStorage,
    public loadedSimplePoolStorageLong: MockSimplePoolStorage,
    public ticksFeesReader: TicksFeesReader,
    public token0: MockToken,
    public token1: MockToken,
    public factory: Factory,
    public router: Router,
    public positionManager: BasePositionManager
  ) {}
}

describe('TicksFeesReader', () => {
  const [admin, user] = waffle.provider.getWallets();
  let allInitTicksShort = genMaxInitTicks(shortTickDistance);
  let allInitTicksLong = genMaxInitTicks(longTickDistance);
  async function fixture() {
    const MockSimplePoolStorageFactory = (await ethers.getContractFactory(
      'MockSimplePoolStorage'
    )) as MockSimplePoolStorage__factory;
    unloadedSimplePoolStorage = await MockSimplePoolStorageFactory.deploy(shortTickDistance);
    loadedSimplePoolStorageShort = await MockSimplePoolStorageFactory.deploy(shortTickDistance);
    await insertTicksByParts(loadedSimplePoolStorageShort, allInitTicksShort);
    loadedSimplePoolStorageLong = await MockSimplePoolStorageFactory.deploy(longTickDistance);
    await insertTicksByParts(loadedSimplePoolStorageLong, allInitTicksLong);

    // deploy TicksFeesReader
    const TicksFeesReaderFactory = (await ethers.getContractFactory('TicksFeesReader')) as TicksFeesReader__factory;
    ticksFeesReader = await TicksFeesReaderFactory.deploy();

    // deploy tokens
    const Token = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    let tokenA = await Token.deploy('USDC', 'USDC', BN.from(100000000000).mul(PRECISION));
    let tokenB = await Token.deploy('DAI', 'DAI', BN.from(100000000000).mul(PRECISION));
    let factory = await deployFactory(admin, 100);

    const WETH = (await ethers.getContractFactory('MockWeth')) as MockWeth__factory;
    let weth = await WETH.deploy();
    const Descriptor = (await ethers.getContractFactory(
      'MockTokenPositionDescriptor'
    )) as MockTokenPositionDescriptor__factory;
    let tokenDescriptor = await Descriptor.deploy();

    let PositionManager = (await ethers.getContractFactory('BasePositionManager')) as BasePositionManager__factory;
    let positionManager = await PositionManager.deploy(factory.address, weth.address, tokenDescriptor.address);
    await factory.connect(admin).addNFTManager(positionManager.address);

    const Router = (await ethers.getContractFactory('Router')) as Router__factory;
    let router = await Router.deploy(factory.address, weth.address);

    await weth.connect(user).deposit({value: PRECISION.mul(10)});
    await weth.connect(user).approve(positionManager.address, MAX_UINT);
    await tokenA.connect(user).approve(positionManager.address, MAX_UINT);
    await tokenB.connect(user).approve(positionManager.address, MAX_UINT);

    await weth.connect(user).approve(router.address, MAX_UINT);
    await tokenA.connect(user).approve(router.address, MAX_UINT);
    await tokenB.connect(user).approve(router.address, MAX_UINT);

    await tokenA.transfer(user.address, PRECISION.mul(2000000));
    await tokenB.transfer(user.address, PRECISION.mul(2000000));

    let [token0, token1] = sortTokens(tokenA.address, tokenB.address);

    return new Fixtures(
      unloadedSimplePoolStorage,
      loadedSimplePoolStorageShort,
      loadedSimplePoolStorageLong,
      ticksFeesReader,
      tokenA.address == token0 ? tokenA : tokenB,
      tokenA.address == token0 ? tokenB : tokenA,
      factory,
      router,
      positionManager
    );
  }

  const swapExactInput = async function (tokenIn: string, tokenOut: string, poolFee: number, amount: BigNumber) {
    const swapParams = {
      tokenIn: tokenIn,
      tokenOut: tokenOut,
      fee: poolFee,
      recipient: user.address,
      deadline: BN.from(2).pow(255),
      amountIn: amount,
      minAmountOut: BN.from(0),
      limitSqrtP: BN.from(0),
    };
    await router.connect(user).swapExactInputSingle(swapParams);
  };

  const burnRTokens = async function (
    tokenIn: string,
    tokenOut: string,
    user: Wallet,
    tokenId: BigNumber
  ): Promise<ContractTransaction> {
    // call to burn rTokens
    let burnRTokenParams = {
      tokenId: tokenId,
      amount0Min: 1,
      amount1Min: 1,
      deadline: PRECISION,
    };
    let multicallData = [positionManager.interface.encodeFunctionData('burnRTokens', [burnRTokenParams])];
    multicallData.push(positionManager.interface.encodeFunctionData('transferAllTokens', [tokenIn, 0, user.address]));
    multicallData.push(positionManager.interface.encodeFunctionData('transferAllTokens', [tokenOut, 0, user.address]));
    let tx = await positionManager.connect(user).multicall(multicallData);
    return tx;
  };

  const removeLiquidity = async function (
    tokenIn: string,
    tokenOut: string,
    user: Wallet,
    tokenId: BigNumber,
    liquidity: BigNumber
  ): Promise<ContractTransaction> {
    let removeLiquidityParams = {
      tokenId: tokenId,
      liquidity: liquidity,
      amount0Min: 0,
      amount1Min: 0,
      deadline: PRECISION,
    };
    // need to use multicall to collect tokens
    let multicallData = [positionManager.interface.encodeFunctionData('removeLiquidity', [removeLiquidityParams])];
    multicallData.push(positionManager.interface.encodeFunctionData('transferAllTokens', [tokenIn, 0, user.address]));
    multicallData.push(positionManager.interface.encodeFunctionData('transferAllTokens', [tokenOut, 0, user.address]));
    let tx = await positionManager.connect(user).multicall(multicallData);
    return tx;
  };

  beforeEach('load fixture', async () => {
    ({
      unloadedSimplePoolStorage,
      loadedSimplePoolStorageShort,
      loadedSimplePoolStorageLong,
      ticksFeesReader,
      token0,
      token1,
      factory,
      router,
      positionManager,
    } = await loadFixture(fixture));
  });

  describe('#getAllTicks', async () => {
    it('should return base case of [MIN_TICK, MAX_TICK]', async () => {
      verifyArrays([MIN_TICK, MAX_TICK], await ticksFeesReader.getAllTicks(unloadedSimplePoolStorage.address));
    });

    it('should return [MIN_TICK, 0, MAX_TICK]', async () => {
      await unloadedSimplePoolStorage.insertTicks([ZERO]);
      verifyArrays([MIN_TICK, ZERO, MAX_TICK], await ticksFeesReader.getAllTicks(unloadedSimplePoolStorage.address));
    });

    it('should return randomly generated sequential array for large tick distance', async () => {
      let resultArr = genRandomInitTicks(longTickDistance);
      await unloadedSimplePoolStorage.insertTicks(resultArr);
      verifyArrays(
        [MIN_TICK.toNumber()].concat(resultArr).concat([MAX_TICK.toNumber()]),
        await ticksFeesReader.getAllTicks(unloadedSimplePoolStorage.address)
      );
    });

    it('should return full sequential array for large tick distance', async () => {
      verifyArrays(
        [MIN_TICK.toNumber()].concat(allInitTicksLong).concat([MAX_TICK.toNumber()]),
        await ticksFeesReader.getAllTicks(loadedSimplePoolStorageLong.address)
      );
    });

    it('will run out of gas for small tick distance', async () => {
      try {
        await ticksFeesReader.estimateGas.getAllTicks(loadedSimplePoolStorageShort.address);
      } catch (e) {}
    });
  });

  describe('#getTicksInRange', async () => {
    it('should return empty array for uninitialized start tick', async () => {
      let resultArr = await ticksFeesReader.getTicksInRange(unloadedSimplePoolStorage.address, 0, 0);
      expect(resultArr.length).to.be.eq(ZERO);
      resultArr = await ticksFeesReader.getTicksInRange(unloadedSimplePoolStorage.address, MIN_TICK.add(ONE), 0);
      expect(resultArr.length).to.be.eq(ZERO);
      resultArr = await ticksFeesReader.getTicksInRange(unloadedSimplePoolStorage.address, MIN_TICK.sub(ONE), 0);
      expect(resultArr.length).to.be.eq(ZERO);
      resultArr = await ticksFeesReader.getTicksInRange(unloadedSimplePoolStorage.address, 0, 100);
      expect(resultArr.length).to.be.eq(ZERO);
    });

    it('should return expected arrays for base case of [MIN_TICK, MAX_TICK]', async () => {
      let resultArr = await ticksFeesReader.getTicksInRange(unloadedSimplePoolStorage.address, MIN_TICK, 1);
      verifyArrays([MIN_TICK], resultArr);
      resultArr = await ticksFeesReader.getTicksInRange(unloadedSimplePoolStorage.address, MAX_TICK, 1);
      verifyArrays([MAX_TICK], resultArr);
      resultArr = await ticksFeesReader.getTicksInRange(unloadedSimplePoolStorage.address, MIN_TICK, 2);
      verifyArrays([MIN_TICK, MAX_TICK], resultArr);
      resultArr = await ticksFeesReader.getTicksInRange(unloadedSimplePoolStorage.address, MAX_TICK, 2);
      verifyArrays([MAX_TICK, ZERO], resultArr);
      resultArr = await ticksFeesReader.getTicksInRange(unloadedSimplePoolStorage.address, MIN_TICK, 5);
      verifyArrays([MIN_TICK, MAX_TICK, ZERO, ZERO, ZERO], resultArr);
      resultArr = await ticksFeesReader.getTicksInRange(unloadedSimplePoolStorage.address, MAX_TICK, 5);
      verifyArrays([MAX_TICK, ZERO, ZERO, ZERO, ZERO], resultArr);
    });

    it('should return desired array of fixed size for different starting initialized ticks and lengths', async () => {
      let resultArr = await ticksFeesReader.getTicksInRange(loadedSimplePoolStorageShort.address, 0, 5);
      verifyArrays([0, 100, 200, 300, 400], resultArr);

      resultArr = await ticksFeesReader.getTicksInRange(loadedSimplePoolStorageShort.address, MIN_TICK, 5);
      verifyArrays([MIN_TICK, -887200, -887100, -887000, -886900], resultArr);

      resultArr = await ticksFeesReader.getTicksInRange(loadedSimplePoolStorageShort.address, -300, 5);
      verifyArrays([-300, -200, -100, 0, 100], resultArr);

      resultArr = await ticksFeesReader.getTicksInRange(loadedSimplePoolStorageShort.address, 886900, 5);
      verifyArrays([886900, 887000, 887100, 887200, MAX_TICK], resultArr);

      resultArr = await ticksFeesReader.getTicksInRange(loadedSimplePoolStorageShort.address, 887200, 5);
      verifyArrays([887200, MAX_TICK, 0, 0, 0], resultArr);

      let arrLength = 500;
      resultArr = await ticksFeesReader.getTicksInRange(loadedSimplePoolStorageShort.address, MIN_TICK, arrLength);
      let expectedArr = [...Array(arrLength - 1).keys()].map((x) => -887200 + x * shortTickDistance);
      verifyArrays([MIN_TICK.toNumber()].concat(expectedArr), resultArr);
    });

    it('should return all ticks if specified length is 0, with appropriate starting tick', async () => {
      let resultArr = await ticksFeesReader.getTicksInRange(unloadedSimplePoolStorage.address, MIN_TICK, 0);
      verifyArrays([MIN_TICK, MAX_TICK], resultArr);

      resultArr = await ticksFeesReader.getTicksInRange(unloadedSimplePoolStorage.address, MAX_TICK, 0);
      verifyArrays([MAX_TICK], resultArr);

      let startTick = 700000;
      resultArr = await ticksFeesReader.getTicksInRange(loadedSimplePoolStorageShort.address, startTick, 0);
      let expectedArr = [...Array(MAX_TICK.div(shortTickDistance)).keys()].map(
        (x) => startTick + x * shortTickDistance
      );
      verifyArrays(expectedArr, resultArr);
    });
  });

  describe('#getNearestInitializedTicks', async () => {
    describe('non-initialization ([MIN_TICK, MAX_TICK])', async () => {
      it('should return MIN_TICK and MAX_TICK regardless of queried tick (within range)', async () => {
        [MIN_TICK, MIN_TICK.add(ONE), NEGATIVE_ONE, ZERO, ONE, BPS, MAX_TICK.sub(ONE), MAX_TICK].forEach(
          async (tick) => {
            let nearestTicks = await ticksFeesReader.getNearestInitializedTicks(
              unloadedSimplePoolStorage.address,
              tick
            );
            expect(nearestTicks.previous).to.be.eq(MIN_TICK);
            expect(nearestTicks.next).to.be.eq(MAX_TICK);
          }
        );
      });
    });

    describe('initalize all ticks for long tick distance', async () => {
      it('should return correct values for MIN_TICK', async () => {
        let nearestTicks = await ticksFeesReader.getNearestInitializedTicks(
          loadedSimplePoolStorageLong.address,
          MIN_TICK
        );
        expect(nearestTicks.previous).to.be.eq(MIN_TICK);
        expect(nearestTicks.next).to.be.eq(-880000);
      });

      it('should return correct values for MAX_TICK', async () => {
        let nearestTicks = await ticksFeesReader.getNearestInitializedTicks(
          loadedSimplePoolStorageLong.address,
          MAX_TICK
        );
        expect(nearestTicks.previous).to.be.eq(880000);
        expect(nearestTicks.next).to.be.eq(MAX_TICK);
      });

      it('should return correct values for other initialized ticks', async () => {
        let arr = allInitTicksLong.slice(1, -2);
        arr.forEach(async (tick) => {
          let nearestTicks = await ticksFeesReader.getNearestInitializedTicks(
            loadedSimplePoolStorageLong.address,
            tick
          );
          expect(nearestTicks.previous).to.be.eq(tick - 10000);
          expect(nearestTicks.next).to.be.eq(tick + 10000);
        });
        // boundary cases
        let nearestTicks = await ticksFeesReader.getNearestInitializedTicks(
          loadedSimplePoolStorageLong.address,
          -880000
        );
        expect(nearestTicks.previous).to.be.eq(MIN_TICK);
        expect(nearestTicks.next).to.be.eq(-870000);

        nearestTicks = await ticksFeesReader.getNearestInitializedTicks(loadedSimplePoolStorageLong.address, 880000);
        expect(nearestTicks.previous).to.be.eq(870000);
        expect(nearestTicks.next).to.be.eq(MAX_TICK);
      });

      it('returns correct values for non-initialized ticks', async () => {
        for (let i = 0; i < 500; i++) {
          // gen random number between min and max ticks
          let randomTick = genRandomBN(MIN_TICK, MAX_TICK);
          while (randomTick.eq(MIN_TICK) || randomTick.eq(MAX_TICK) || randomTick.toNumber() % longTickDistance == 0) {
            randomTick = genRandomBN(MIN_TICK, MAX_TICK);
          }
          let nearestTicks = await ticksFeesReader.getNearestInitializedTicks(
            loadedSimplePoolStorageLong.address,
            randomTick
          );
          expect(nearestTicks.previous).to.be.eq(
            Math.max(MIN_TICK.toNumber(), Math.floor(randomTick.toNumber() / longTickDistance) * longTickDistance)
          );
          expect(nearestTicks.next).to.be.eq(
            Math.min(MAX_TICK.toNumber(), Math.ceil(randomTick.toNumber() / longTickDistance) * longTickDistance)
          );
        }
      });
    });
  });

  describe('#getTotalRTokensOwedToPosition & #getTotalFeesOwedToPosition', async () => {
    beforeEach('create, unlock and add liquidity to pool', async () => {
      initialPrice = encodePriceSqrt(1, 1);
      nextTokenId = await positionManager.nextTokenId();
      await positionManager
        .connect(user)
        .createAndUnlockPoolIfNecessary(token0.address, token1.address, swapFee, initialPrice);

      pool = await factory.getPool(token0.address, token1.address, swapFee);

      await positionManager.connect(user).mint({
        token0: token0.address,
        token1: token1.address,
        fee: swapFee,
        tickLower: positionLowerTick,
        tickUpper: positionUpperTick,
        ticksPrevious: ticksPrevious,
        amount0Desired: BN.from(1000000),
        amount1Desired: BN.from(1000000),
        amount0Min: 0,
        amount1Min: 0,
        recipient: user.address,
        deadline: PRECISION,
      });

      outRangeTokenId = await positionManager.nextTokenId();

      await positionManager.connect(user).mint({
        token0: token0.address,
        token1: token1.address,
        fee: swapFee,
        tickLower: MIN_TICK,
        tickUpper: positionLowerTick,
        ticksPrevious: ticksPrevious,
        amount0Desired: BN.from(100000000),
        amount1Desired: BN.from(100000000),
        amount0Min: 0,
        amount1Min: 0,
        recipient: user.address,
        deadline: PRECISION,
      });
    });

    it('should revert if pool and requested tokenId dont match', async () => {
      await expect(ticksFeesReader.getTotalRTokensOwedToPosition(positionManager.address, pool, 0)).to.be.revertedWith(
        'tokenId and pool dont match'
      );

      await expect(ticksFeesReader.getTotalFeesOwedToPosition(positionManager.address, pool, 0)).to.be.revertedWith(
        'tokenId and pool dont match'
      );
    });

    it('should return zero values since no swaps were performed', async () => {
      expect(await ticksFeesReader.getTotalRTokensOwedToPosition(positionManager.address, pool, nextTokenId)).to.be.eq(
        ZERO
      );

      let result = await ticksFeesReader.getTotalFeesOwedToPosition(positionManager.address, pool, nextTokenId);
      expect(result.token0Owed).to.be.eq(ZERO);
      expect(result.token1Owed).to.be.eq(ZERO);
    });

    it('should return zero because position is inactive', async () => {
      for (let j = 0; j < 10; j++) {
        let amount = BN.from(100000 * (j + 1));
        await swapExactInput(token0.address, token1.address, swapFee, amount);
        amount = BN.from(100000 * (j + 1));
        await swapExactInput(token1.address, token0.address, swapFee, amount);
      }

      let result = await ticksFeesReader.getTotalFeesOwedToPosition(positionManager.address, pool, outRangeTokenId);
      expect(result.token0Owed).to.be.eq(ZERO);
      expect(result.token1Owed).to.be.eq(ZERO);
    });

    it('should return correct values after 10 swaps and position is active', async () => {
      for (let j = 0; j < 10; j++) {
        let amount = BN.from(100000 * (j + 1));
        await swapExactInput(token0.address, token1.address, swapFee, amount);
        amount = BN.from(100000 * (j + 1));
        await swapExactInput(token1.address, token0.address, swapFee, amount);
      }
      let expectedRTokenOwed = await ticksFeesReader.getTotalRTokensOwedToPosition(
        positionManager.address,
        pool,
        nextTokenId
      );
      let expectedTokensOwed = await ticksFeesReader.getTotalFeesOwedToPosition(
        positionManager.address,
        pool,
        nextTokenId
      );

      await removeLiquidity(token0.address, token1.address, user as Wallet, nextTokenId, BN.from(1));
      let actualRTokensOwed = (await positionManager.positions(nextTokenId)).pos.rTokenOwed;
      expect(expectedRTokenOwed).to.be.eq(actualRTokensOwed);

      let token0BalBefore = await token0.balanceOf(user.address);
      let token1BalBefore = await token1.balanceOf(user.address);
      await burnRTokens(token0.address, token1.address, user as Wallet, nextTokenId);
      expect(expectedTokensOwed.token0Owed).to.be.eq((await token0.balanceOf(user.address)).sub(token0BalBefore));
      expect(expectedTokensOwed.token1Owed).to.be.eq((await token1.balanceOf(user.address)).sub(token1BalBefore));
    });

    it('should return correct values after 20 swaps and position is active', async () => {
      for (let j = 0; j < 20; j++) {
        let amount = BN.from(100000 * (j + 1));
        await swapExactInput(token0.address, token1.address, swapFee, amount);
        amount = BN.from(100000 * (j + 1));
        await swapExactInput(token1.address, token0.address, swapFee, amount);
      }
      let expectedRTokenOwed = await ticksFeesReader.getTotalRTokensOwedToPosition(
        positionManager.address,
        pool,
        nextTokenId
      );
      let expectedTokensOwed = await ticksFeesReader.getTotalFeesOwedToPosition(
        positionManager.address,
        pool,
        nextTokenId
      );

      await removeLiquidity(token0.address, token1.address, user as Wallet, nextTokenId, BN.from(1));
      let actualRTokensOwed = (await positionManager.positions(nextTokenId)).pos.rTokenOwed;
      expect(expectedRTokenOwed).to.be.eq(actualRTokensOwed);

      let token0BalBefore = await token0.balanceOf(user.address);
      let token1BalBefore = await token1.balanceOf(user.address);
      await burnRTokens(token0.address, token1.address, user as Wallet, nextTokenId);
      expect(expectedTokensOwed.token0Owed).to.be.eq((await token0.balanceOf(user.address)).sub(token0BalBefore));
      expect(expectedTokensOwed.token1Owed).to.be.eq((await token1.balanceOf(user.address)).sub(token1BalBefore));
    });

    it('should return correct values after 10 active swaps and 10 inactive swaps', async () => {
      //active swaps
      for (let j = 0; j < 10; j++) {
        let amount = BN.from(100000 * (j + 1));
        await swapExactInput(token0.address, token1.address, swapFee, amount);
        amount = BN.from(100000 * (j + 1));
        await swapExactInput(token1.address, token0.address, swapFee, amount);
      }

      //push currentTick move out of position lowerTick
      await swapExactInput(token0.address, token1.address, swapFee, BN.from(10000000));

      let poolContract = (await ethers.getContractAt('Pool', pool)) as Pool;
      let poolState = await poolContract.getPoolState();

      //make sure currentTick is lower than position's lowerTick
      expect(poolState.currentTick).to.be.lessThan(positionLowerTick);

      let expectedRTokenOwedBefore = await ticksFeesReader.getTotalRTokensOwedToPosition(
        positionManager.address,
        pool,
        nextTokenId
      );

      //inactive swaps => not getting any fee from this
      for (let j = 0; j < 10; j++) {
        let amount = BN.from(100000 * (j + 1));
        await swapExactInput(token0.address, token1.address, swapFee, amount);
        amount = BN.from(100000 * (j + 1));
        await swapExactInput(token1.address, token0.address, swapFee, amount);

        poolState = await poolContract.getPoolState();
        expect(poolState.currentTick).to.be.lessThan(positionLowerTick);
      }

      let expectedRTokenOwed = await ticksFeesReader.getTotalRTokensOwedToPosition(
        positionManager.address,
        pool,
        nextTokenId
      );

      let expectedTokensOwed = await ticksFeesReader.getTotalFeesOwedToPosition(
        positionManager.address,
        pool,
        nextTokenId
      );

      expect(expectedRTokenOwedBefore).to.be.eq(expectedRTokenOwed);

      await removeLiquidity(token0.address, token1.address, user as Wallet, nextTokenId, BN.from(1));
      let actualRTokensOwed = (await positionManager.positions(nextTokenId)).pos.rTokenOwed;
      expect(expectedRTokenOwed).to.be.eq(actualRTokensOwed);

      let token0BalBefore = await token0.balanceOf(user.address);
      let token1BalBefore = await token1.balanceOf(user.address);
      await burnRTokens(token0.address, token1.address, user as Wallet, nextTokenId);
      expect(expectedTokensOwed.token0Owed).to.be.eq((await token0.balanceOf(user.address)).sub(token0BalBefore));
      expect(expectedTokensOwed.token1Owed).to.be.eq((await token1.balanceOf(user.address)).sub(token1BalBefore));
    });

    it('should return correct values after 10 inactive swaps and 10 active swaps', async () => {
      //make currentTick lower than position's lowerTick
      await swapExactInput(token0.address, token1.address, swapFee, BN.from(10000000));

      let poolContract = (await ethers.getContractAt('Pool', pool)) as Pool;
      let poolState = await poolContract.getPoolState();

      //make sure currentTick is lower than position's lowerTick
      expect(poolState.currentTick).to.be.lessThan(positionLowerTick);

      let expectedRTokenOwedBefore = await ticksFeesReader.getTotalRTokensOwedToPosition(
        positionManager.address,
        pool,
        nextTokenId
      );

      //inactive swaps
      for (let j = 0; j < 10; j++) {
        let amount = BN.from(100000 * (j + 1));
        await swapExactInput(token0.address, token1.address, swapFee, amount);
        amount = BN.from(100000 * (j + 1));
        await swapExactInput(token1.address, token0.address, swapFee, amount);

        poolState = await poolContract.getPoolState();
        expect(poolState.currentTick).to.be.lessThan(positionLowerTick);
      }

      let expectedRTokenOwedAfter = await ticksFeesReader.getTotalRTokensOwedToPosition(
        positionManager.address,
        pool,
        nextTokenId
      );

      //rTokenOwned before and after inactive swaps must be the same
      expect(expectedRTokenOwedBefore).to.be.eq(expectedRTokenOwedAfter);

      //make currentTick greater than position's lowerTick
      await swapExactInput(token1.address, token0.address, swapFee, BN.from(7000000));

      //make sure currentTick inside position
      poolState = await poolContract.getPoolState();
      expect(poolState.currentTick).to.be.greaterThan(positionLowerTick).to.be.lessThan(positionUpperTick);

      //active swaps
      for (let j = 0; j < 10; j++) {
        let amount = BN.from(100000 * (j + 1));
        await swapExactInput(token0.address, token1.address, swapFee, amount);
        amount = BN.from(100000 * (j + 1));
        await swapExactInput(token1.address, token0.address, swapFee, amount);
      }

      let expectedRTokenOwed = await ticksFeesReader.getTotalRTokensOwedToPosition(
        positionManager.address,
        pool,
        nextTokenId
      );
      let expectedTokensOwed = await ticksFeesReader.getTotalFeesOwedToPosition(
        positionManager.address,
        pool,
        nextTokenId
      );

      //rTokenOwned should be increase after 10 active swaps
      expect(expectedRTokenOwedAfter.toNumber()).to.be.lessThan(expectedRTokenOwed.toNumber());

      await removeLiquidity(token0.address, token1.address, user as Wallet, nextTokenId, BN.from(1));
      let actualRTokensOwed = (await positionManager.positions(nextTokenId)).pos.rTokenOwed;
      expect(expectedRTokenOwed).to.be.eq(actualRTokensOwed);

      let token0BalBefore = await token0.balanceOf(user.address);
      let token1BalBefore = await token1.balanceOf(user.address);
      await burnRTokens(token0.address, token1.address, user as Wallet, nextTokenId);
      expect(expectedTokensOwed.token0Owed).to.be.eq((await token0.balanceOf(user.address)).sub(token0BalBefore));
      expect(expectedTokensOwed.token1Owed).to.be.eq((await token1.balanceOf(user.address)).sub(token1BalBefore));
    });
  });
});
