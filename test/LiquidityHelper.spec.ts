import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {BigNumber as BN} from 'ethers';
import {PRECISION, ZERO_ADDRESS, ONE, TWO, ZERO, MAX_UINT} from './helpers/helper';
import {encodePriceSqrt, getBalances} from './helpers/utils';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {
  MockToken,
  MockToken__factory,
  MockWeth,
  MockWeth__factory,
  MockLiquidityHelper,
  MockLiquidityHelper__factory,
  ProAMMFactory
} from '../typechain';

import {deployFactory} from './helpers/proAMMSetup';
import {snapshot, revertToSnapshot} from './helpers/hardhat';
import {ProAMMPool} from '../typechain/ProAMMPool';

let TokenFactory: MockToken__factory;
let factory: ProAMMFactory;
let liquidityHelper: MockLiquidityHelper;
let tokenA: MockToken;
let tokenB: MockToken;
let weth: MockWeth;
let swapFeeBpsArray = [5, 30];
let tickSpacingArray = [10, 60];
let initialPrice = encodePriceSqrt(1, 1);
let snapshotId: any;

describe('LiquidityHelper', () => {
  const [user, admin] = waffle.provider.getWallets();

  before('factory, token and callback setup', async () => {
    TokenFactory = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    tokenA = await TokenFactory.deploy('USDC', 'USDC', BN.from(1000000).mul(PRECISION));
    tokenB = await TokenFactory.deploy('DAI', 'DAI', BN.from(1000000).mul(PRECISION));
    factory = await deployFactory(admin);

    const WETHContract = (await ethers.getContractFactory('MockWeth')) as MockWeth__factory;
    weth = await WETHContract.deploy();

    // use liquidity helper
    const LiquidityHelpeContract = (await ethers.getContractFactory(
      'MockLiquidityHelper'
    )) as MockLiquidityHelper__factory;
    liquidityHelper = await LiquidityHelpeContract.deploy(factory.address, weth.address);

    // add any newly defined tickSpacing apart from default ones
    for (let i = 0; i < swapFeeBpsArray.length; i++) {
      if ((await factory.feeAmountTickSpacing(swapFeeBpsArray[i])) == 0) {
        await factory.connect(admin).enableSwapFee(swapFeeBpsArray[i], tickSpacingArray[i]);
      }
    }

    await weth.connect(user).deposit({value: PRECISION.mul(BN.from(10))});
    await weth.connect(user).approve(liquidityHelper.address, MAX_UINT);
    await tokenA.connect(user).approve(liquidityHelper.address, MAX_UINT);
    await tokenB.connect(user).approve(liquidityHelper.address, MAX_UINT);

    snapshotId = await snapshot();
  });

  const createPool = async function (token0: string, token1: string, fee: number): Promise<ProAMMPool> {
    await factory.createPool(token0, token1, fee);
    let pool = (await ethers.getContractAt('ProAMMPool', await factory.getPool(token0, token1, fee))) as ProAMMPool;
    return pool;
  };

  describe('#unlockPool', async () => {
    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
    });

    it('correct tokens transfer from user to the pool', async () => {
      let firstTokens = [weth.address, tokenA.address, tokenB.address];
      let secondTokens = [tokenA.address, tokenB.address, weth.address];
      for (let i = 0; i < firstTokens.length; i++) {
        let fee = swapFeeBpsArray[i % swapFeeBpsArray.length];
        let initPrice = encodePriceSqrt(121, 100);
        let pool = await createPool(firstTokens[i], secondTokens[i], fee);

        let userBefore = await getBalances(user.address, [firstTokens[i], secondTokens[i]]);
        let poolBefore = await getBalances(pool.address, [firstTokens[i], secondTokens[i]]);

        await liquidityHelper.connect(user).testUnlockPool(firstTokens[i], secondTokens[i], fee, initPrice);

        let userAfter = await getBalances(user.address, [firstTokens[i], secondTokens[i]]);
        let poolAfter = await getBalances(pool.address, [firstTokens[i], secondTokens[i]]);

        expect(userBefore[0].sub(userAfter[0])).to.be.eq(poolAfter[0].sub(poolBefore[0]));
        expect(userBefore[1].sub(userAfter[1])).to.be.eq(poolAfter[1].sub(poolBefore[1]));
      }
    });

    it('can setup to unlock with eth', async () => {
      let fee = swapFeeBpsArray[0];
      let initPrice = encodePriceSqrt(121, 100);
      let pool = await createPool(weth.address, tokenA.address, fee);

      let userBefore = await getBalances(user.address, [ZERO_ADDRESS, weth.address, tokenA.address]);
      let poolBefore = await getBalances(pool.address, [ZERO_ADDRESS, weth.address, tokenA.address]);

      let multicallData = [
        liquidityHelper.interface.encodeFunctionData('testUnlockPool', [weth.address, tokenA.address, fee, initPrice])
      ];
      multicallData.push(liquidityHelper.interface.encodeFunctionData('refundETH')); // refund redundant eth back to user

      await liquidityHelper.connect(user).multicall(multicallData, {value: PRECISION, gasPrice: ZERO});

      let userAfter = await getBalances(user.address, [ZERO_ADDRESS, weth.address, tokenA.address]);
      let poolAfter = await getBalances(pool.address, [ZERO_ADDRESS, weth.address, tokenA.address]);

      expect(userBefore[0].sub(userAfter[0])).to.be.eq(poolAfter[1].sub(poolBefore[1]));
      expect(userBefore[2].sub(userAfter[2])).to.be.eq(poolAfter[2].sub(poolBefore[2]));
    });

    it('revert pool already unlocked', async () => {
      let fee = swapFeeBpsArray[0];
      let initPrice = encodePriceSqrt(121, 100);
      await createPool(tokenA.address, tokenB.address, fee);
      await liquidityHelper.connect(user).testUnlockPool(tokenA.address, tokenB.address, fee, initPrice);
      await expect(
        liquidityHelper.connect(user).testUnlockPool(tokenA.address, tokenB.address, fee, initPrice)
      ).to.be.revertedWith('already inited');
    });
  });

  describe(`#addLiquidity`, async () => {
    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
    });

    it(`reverts token0 > token1`, async () => {
      let token0 = tokenA.address > tokenB.address ? tokenA.address : tokenB.address;
      let token1 = tokenA.address > tokenB.address ? tokenB.address : tokenA.address;
      await createPool(token0, token1, swapFeeBpsArray[0]);
      await liquidityHelper.connect(user).testUnlockPool(token0, token1, swapFeeBpsArray[0], initialPrice);

      await expect(
        liquidityHelper.connect(user).testAddLiquidity({
          token0: token0,
          token1: token1,
          fee: swapFeeBpsArray[0],
          recipient: user.address,
          tickLower: -100 * tickSpacingArray[0],
          tickUpper: 100 * tickSpacingArray[0],
          amount0Desired: PRECISION,
          amount1Desired: PRECISION,
          amount0Min: BN.from(0),
          amount1Min: BN.from(0)
        })
      ).to.be.revertedWith('LiquidityHelper: invalid token order');
    });

    it('reverts lower than min amount', async () => {
      let token0 = tokenA.address > tokenB.address ? tokenB.address : tokenA.address;
      let token1 = tokenA.address > tokenB.address ? tokenA.address : tokenB.address;
      await createPool(token0, token1, swapFeeBpsArray[0]);
      await liquidityHelper.connect(user).testUnlockPool(token0, token1, swapFeeBpsArray[0], initialPrice);

      await expect(
        liquidityHelper.connect(user).testAddLiquidity({
          token0: token0,
          token1: token1,
          fee: swapFeeBpsArray[0],
          recipient: user.address,
          tickLower: -100 * tickSpacingArray[0],
          tickUpper: 100 * tickSpacingArray[0],
          amount0Desired: PRECISION,
          amount1Desired: PRECISION,
          amount0Min: PRECISION.add(ONE),
          amount1Min: BN.from(0)
        })
      ).to.be.revertedWith('LiquidityHelper: price slippage check');
      await expect(
        liquidityHelper.connect(user).testAddLiquidity({
          token0: token0,
          token1: token1,
          fee: swapFeeBpsArray[0],
          recipient: user.address,
          tickLower: -100 * tickSpacingArray[0],
          tickUpper: 100 * tickSpacingArray[0],
          amount0Desired: PRECISION,
          amount1Desired: PRECISION,
          amount0Min: BN.from(0),
          amount1Min: PRECISION.add(ONE)
        })
      ).to.be.revertedWith('LiquidityHelper: price slippage check');
    });

    it('correct tokens transfer to pool', async () => {
      let firstTokens = [weth.address, tokenA.address, tokenB.address];
      let secondTokens = [tokenA.address, tokenB.address, weth.address];
      for (let i = 0; i < firstTokens.length; i++) {
        let index = i % swapFeeBpsArray.length;
        let fee = swapFeeBpsArray[index];

        let token0 = firstTokens[i] < secondTokens[i] ? firstTokens[i] : secondTokens[i];
        let token1 = firstTokens[i] < secondTokens[i] ? secondTokens[i] : firstTokens[i];

        let pool = await createPool(token0, token1, swapFeeBpsArray[index]);
        await liquidityHelper.connect(user).testUnlockPool(token0, token1, swapFeeBpsArray[index], initialPrice);

        let userBefore = await getBalances(user.address, [firstTokens[i], secondTokens[i]]);
        let poolBefore = await getBalances(pool.address, [firstTokens[i], secondTokens[i]]);

        await liquidityHelper.connect(user).testAddLiquidity({
          token0: token0,
          token1: token1,
          fee: fee,
          recipient: user.address,
          tickLower: -100 * tickSpacingArray[index],
          tickUpper: 100 * tickSpacingArray[index],
          amount0Desired: PRECISION,
          amount1Desired: PRECISION,
          amount0Min: BN.from(0),
          amount1Min: BN.from(0)
        });

        let userAfter = await getBalances(user.address, [firstTokens[i], secondTokens[i]]);
        let poolAfter = await getBalances(pool.address, [firstTokens[i], secondTokens[i]]);

        expect(userBefore[0].sub(userAfter[0])).to.be.eq(poolAfter[0].sub(poolBefore[0]));
        expect(userBefore[1].sub(userAfter[1])).to.be.eq(poolAfter[1].sub(poolBefore[1]));
      }
    });

    it('can setup to unlock with eth', async () => {
      let fee = swapFeeBpsArray[0];

      let pool = await createPool(weth.address, tokenA.address, fee);
      await liquidityHelper.connect(user).testUnlockPool(weth.address, tokenA.address, fee, initialPrice);

      let userBefore = await getBalances(user.address, [ZERO_ADDRESS, weth.address, tokenA.address]);
      let poolBefore = await getBalances(pool.address, [ZERO_ADDRESS, weth.address, tokenA.address]);

      let token0 = weth.address < tokenA.address ? weth.address : tokenA.address;
      let token1 = weth.address > tokenA.address ? weth.address : tokenA.address;

      let params = {
        token0: token0,
        token1: token1,
        fee: fee,
        recipient: user.address,
        tickLower: -100 * tickSpacingArray[0],
        tickUpper: 100 * tickSpacingArray[0],
        amount0Desired: PRECISION,
        amount1Desired: PRECISION,
        amount0Min: BN.from(0),
        amount1Min: BN.from(0)
      };

      let multicallData = [liquidityHelper.interface.encodeFunctionData('testAddLiquidity', [params])];
      multicallData.push(liquidityHelper.interface.encodeFunctionData('refundETH')); // refund redundant eth back to user

      await liquidityHelper.connect(user).multicall(multicallData, {value: PRECISION.mul(TWO), gasPrice: ZERO});

      let userAfter = await getBalances(user.address, [ZERO_ADDRESS, weth.address, tokenA.address]);
      let poolAfter = await getBalances(pool.address, [ZERO_ADDRESS, weth.address, tokenA.address]);

      expect(userBefore[0].sub(userAfter[0])).to.be.eq(poolAfter[1].sub(poolBefore[1]));
      expect(userBefore[2].sub(userAfter[2])).to.be.eq(poolAfter[2].sub(poolBefore[2]));
    });
  });
});