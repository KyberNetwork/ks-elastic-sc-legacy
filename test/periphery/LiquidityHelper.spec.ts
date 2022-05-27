import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {BigNumber as BN} from 'ethers';
import {PRECISION, ZERO_ADDRESS, ONE, TWO, ZERO, MAX_UINT, MIN_TICK} from '../helpers/helper';
import {encodePriceSqrt, getBalances, sortTokens} from '../helpers/utils';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {MockToken, MockToken__factory, MockWeth, MockWeth__factory} from '../../typechain';
import {MockLiquidityHelper, MockLiquidityHelper__factory, Factory, Pool} from '../../typechain';

import {deployFactory} from '../helpers/setup';
import {snapshot, revertToSnapshot} from '../helpers/hardhat';

let TokenFactory: MockToken__factory;
let factory: Factory;
let liquidityHelper: MockLiquidityHelper;
let tokenA: MockToken;
let tokenB: MockToken;
let weth: MockWeth;
let swapFeeUnitsArray = [50, 300];
let tickDistanceArray = [10, 60];
let vestingPeriod = 100;
let initialPrice = encodePriceSqrt(1, 1);
let snapshotId: any;
let ticksPrevious: [BN, BN] = [MIN_TICK, MIN_TICK];

describe('LiquidityHelper', () => {
  const [user, admin] = waffle.provider.getWallets();

  before('factory, token and callback setup', async () => {
    TokenFactory = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    tokenA = await TokenFactory.deploy('USDC', 'USDC', BN.from(1000000).mul(PRECISION));
    tokenB = await TokenFactory.deploy('DAI', 'DAI', BN.from(1000000).mul(PRECISION));
    factory = await deployFactory(admin, vestingPeriod);

    const WETHContract = (await ethers.getContractFactory('MockWeth')) as MockWeth__factory;
    weth = await WETHContract.deploy();

    // use liquidity helper
    const LiquidityHelperContract = (await ethers.getContractFactory(
      'MockLiquidityHelper'
    )) as MockLiquidityHelper__factory;
    liquidityHelper = await LiquidityHelperContract.deploy(factory.address, weth.address);

    // whitelist liquidity helper
    await factory.connect(admin).addNFTManager(liquidityHelper.address);

    // add any newly defined tickDistance apart from default ones
    for (let i = 0; i < swapFeeUnitsArray.length; i++) {
      if ((await factory.feeAmountTickDistance(swapFeeUnitsArray[i])) == 0) {
        await factory.connect(admin).enableSwapFee(swapFeeUnitsArray[i], tickDistanceArray[i]);
      }
    }

    await weth.connect(user).deposit({value: PRECISION.mul(BN.from(10))});
    await weth.connect(user).approve(liquidityHelper.address, MAX_UINT);
    await tokenA.connect(user).approve(liquidityHelper.address, MAX_UINT);
    await tokenB.connect(user).approve(liquidityHelper.address, MAX_UINT);

    snapshotId = await snapshot();
  });

  const createPool = async function (token0: string, token1: string, fee: number): Promise<Pool> {
    await factory.createPool(token0, token1, fee);
    let pool = (await ethers.getContractAt('Pool', await factory.getPool(token0, token1, fee))) as Pool;
    return pool;
  };

  describe(`#addLiquidity`, async () => {
    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
    });

    it(`reverts token0 > token1`, async () => {
      let [token0, token1] = sortTokens(tokenA.address, tokenB.address);
      await createPool(token0, token1, swapFeeUnitsArray[0]);
      await liquidityHelper.connect(user).testUnlockPool(token0, token1, swapFeeUnitsArray[0], initialPrice);

      await expect(
        liquidityHelper.connect(user).testAddLiquidity({
          token0: token1,
          token1: token0,
          fee: swapFeeUnitsArray[0],
          recipient: user.address,
          tickLower: -100 * tickDistanceArray[0],
          tickUpper: 100 * tickDistanceArray[0],
          ticksPrevious,
          amount0Desired: PRECISION,
          amount1Desired: PRECISION,
          amount0Min: BN.from(0),
          amount1Min: BN.from(0),
        })
      ).to.be.revertedWith('LiquidityHelper: invalid token order');
    });

    it('reverts lower than min amount', async () => {
      let [token0, token1] = sortTokens(tokenA.address, tokenB.address);
      await createPool(token0, token1, swapFeeUnitsArray[0]);
      await liquidityHelper.connect(user).testUnlockPool(token0, token1, swapFeeUnitsArray[0], initialPrice);

      await expect(
        liquidityHelper.connect(user).testAddLiquidity({
          token0: token0,
          token1: token1,
          fee: swapFeeUnitsArray[0],
          recipient: user.address,
          tickLower: -100 * tickDistanceArray[0],
          tickUpper: 100 * tickDistanceArray[0],
          ticksPrevious,
          amount0Desired: PRECISION,
          amount1Desired: PRECISION,
          amount0Min: PRECISION.add(ONE),
          amount1Min: BN.from(0),
        })
      ).to.be.revertedWith('LiquidityHelper: price slippage check');
      await expect(
        liquidityHelper.connect(user).testAddLiquidity({
          token0: token0,
          token1: token1,
          fee: swapFeeUnitsArray[0],
          recipient: user.address,
          tickLower: -100 * tickDistanceArray[0],
          tickUpper: 100 * tickDistanceArray[0],
          ticksPrevious: [MIN_TICK, MIN_TICK],
          amount0Desired: PRECISION,
          amount1Desired: PRECISION,
          amount0Min: BN.from(0),
          amount1Min: PRECISION.add(ONE),
        })
      ).to.be.revertedWith('LiquidityHelper: price slippage check');
    });

    it('correct tokens transfer to pool', async () => {
      let firstTokens = [weth.address, tokenA.address, tokenB.address];
      let secondTokens = [tokenA.address, tokenB.address, weth.address];
      for (let i = 0; i < firstTokens.length; i++) {
        let index = i % swapFeeUnitsArray.length;
        let fee = swapFeeUnitsArray[index];
        let [token0, token1] = sortTokens(firstTokens[i], secondTokens[i]);

        let pool = await createPool(token0, token1, swapFeeUnitsArray[index]);
        await liquidityHelper.connect(user).testUnlockPool(token0, token1, swapFeeUnitsArray[index], initialPrice);

        let userBefore = await getBalances(user.address, [firstTokens[i], secondTokens[i]]);
        let poolBefore = await getBalances(pool.address, [firstTokens[i], secondTokens[i]]);

        await liquidityHelper.connect(user).testAddLiquidity({
          token0: token0,
          token1: token1,
          fee: fee,
          recipient: user.address,
          tickLower: (50 - i * 100) * tickDistanceArray[index],
          tickUpper: (150 - i * 100) * tickDistanceArray[index],
          ticksPrevious: [MIN_TICK, MIN_TICK],
          amount0Desired: PRECISION,
          amount1Desired: PRECISION,
          amount0Min: BN.from(0),
          amount1Min: BN.from(0),
        });

        let userAfter = await getBalances(user.address, [firstTokens[i], secondTokens[i]]);
        let poolAfter = await getBalances(pool.address, [firstTokens[i], secondTokens[i]]);

        expect(userBefore[0].sub(userAfter[0])).to.be.eq(poolAfter[0].sub(poolBefore[0]));
        expect(userBefore[1].sub(userAfter[1])).to.be.eq(poolAfter[1].sub(poolBefore[1]));
      }
    });

    it('can setup to unlock with eth', async () => {
      let fee = swapFeeUnitsArray[0];

      let pool = await createPool(weth.address, tokenA.address, fee);
      await liquidityHelper.connect(user).testUnlockPool(weth.address, tokenA.address, fee, initialPrice);

      let userBefore = await getBalances(user.address, [ZERO_ADDRESS, weth.address, tokenA.address]);
      let poolBefore = await getBalances(pool.address, [ZERO_ADDRESS, weth.address, tokenA.address]);

      let [token0, token1] = sortTokens(weth.address, tokenA.address);

      let params = {
        token0: token0,
        token1: token1,
        fee: fee,
        recipient: user.address,
        tickLower: -100 * tickDistanceArray[0],
        tickUpper: 100 * tickDistanceArray[0],
        ticksPrevious,
        amount0Desired: PRECISION,
        amount1Desired: PRECISION,
        amount0Min: BN.from(0),
        amount1Min: BN.from(0),
      };

      let multicallData = [liquidityHelper.interface.encodeFunctionData('testAddLiquidity', [params])];
      multicallData.push(liquidityHelper.interface.encodeFunctionData('refundEth')); // refund redundant eth back to user

      await liquidityHelper.connect(user).multicall(multicallData, {value: PRECISION.mul(TWO), gasPrice: ZERO});

      let userAfter = await getBalances(user.address, [ZERO_ADDRESS, weth.address, tokenA.address]);
      let poolAfter = await getBalances(pool.address, [ZERO_ADDRESS, weth.address, tokenA.address]);

      expect(userBefore[0].sub(userAfter[0])).to.be.eq(poolAfter[1].sub(poolBefore[1]));
      expect(userBefore[2].sub(userAfter[2])).to.be.eq(poolAfter[2].sub(poolBefore[2]));
    });
  });

  describe('mintCallback', async () => {
    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
    });

    it(`reverts token0 > token1`, async () => {
      let [token0, token1] = sortTokens(tokenA.address, tokenB.address);
      let encodedData = ethers.utils.defaultAbiCoder.encode(
        ['tuple(address, address, uint24, address)'],
        [[token1, token0, swapFeeUnitsArray[0], user.address]]
      );
      await expect(liquidityHelper.connect(user).mintCallback(PRECISION, PRECISION, encodedData)).to.be.revertedWith(
        'LiquidityHelper: wrong token order'
      );
    });

    it(`reverts for bad caller`, async () => {
      let [token0, token1] = sortTokens(tokenA.address, tokenB.address);
      let encodedData = ethers.utils.defaultAbiCoder.encode(
        ['tuple(address, address, uint24, address)'],
        [[token0, token1, swapFeeUnitsArray[0], user.address]]
      );
      await expect(liquidityHelper.connect(user).mintCallback(PRECISION, PRECISION, encodedData)).to.be.revertedWith(
        'LiquidityHelper: invalid callback sender'
      );
    });
  });
});
