import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {BigNumber} from 'ethers';
import {BN, PRECISION, ZERO_ADDRESS, ONE, TWO} from './helpers/helper';
import {encodePriceSqrt} from './helpers/utils';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {
  MockToken, MockToken__factory,
  MockWeth, MockWeth__factory,
  MockLiquidityHelper, MockLiquidityHelper__factory,
  ProAMMFactory
} from '../typechain';

import {deployFactory} from './helpers/proAMMSetup';
import {snapshot, revertToSnapshot} from './helpers/hardhat';
import { ProAMMPool } from '../typechain/ProAMMPool';

const txGasPrice = BN.from(100).mul(BN.from(10).pow(9));

let Token: MockToken__factory;
let LiquidityHelper: MockLiquidityHelper__factory;
let admin;
let user;
let factory: ProAMMFactory;
let liquidityHelper: MockLiquidityHelper;
let tokenA: MockToken;
let tokenB: MockToken;
let weth: MockWeth;
let swapFeeBpsArray = [5, 30];
let tickSpacingArray = [10, 60];
let vestingPeriod = 100;
let initialPrice: BigNumber;
let snapshotId: any;

let getBalances: (
  who: string,
  tokens: string[]
) => Promise<{
  tokenBalances: BigNumber[]
}>


describe('LiquidityHelper', () => {
  const [user, admin] = waffle.provider.getWallets();

  before('factory, token and callback setup', async () => {
    Token = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    tokenA = await Token.deploy('USDC', 'USDC', BN.from(1000000).mul(PRECISION));
    tokenB = await Token.deploy('DAI', 'DAI', BN.from(1000000).mul(PRECISION));
    factory = await deployFactory(admin, vestingPeriod);

    const WETH = (await ethers.getContractFactory('MockWeth')) as MockWeth__factory;
    weth = await WETH.deploy();

    // use liquidity helper
    LiquidityHelper = await ethers.getContractFactory('MockLiquidityHelper') as MockLiquidityHelper__factory;
    liquidityHelper = await LiquidityHelper.deploy(factory.address, weth.address);

    // whitelist liquidity helper
    await factory.connect(admin).addNFTManager(liquidityHelper.address);

    // add any newly defined tickSpacing apart from default ones
    for (let i = 0; i < swapFeeBpsArray.length; i++) {
      if ((await factory.feeAmountTickSpacing(swapFeeBpsArray[i])) == 0) {
        await factory.connect(admin).enableSwapFee(swapFeeBpsArray[i], tickSpacingArray[i]);
      }
    }

    initialPrice = encodePriceSqrt(1, 1);

    await weth.connect(user).deposit({ value: PRECISION.mul(BN.from(10)) });
    await weth.connect(user).approve(liquidityHelper.address, BN.from(2).pow(255));
    await tokenA.connect(user).approve(liquidityHelper.address, BN.from(2).pow(255));
    await tokenB.connect(user).approve(liquidityHelper.address, BN.from(2).pow(255));

    getBalances = async (account: string, tokens: string[]) => {
      let balances = [];
      for (let i = 0; i < tokens.length; i++) {
        if (tokens[i] == ZERO_ADDRESS) {
          balances.push(await ethers.provider.getBalance(account))
        } else {
          balances.push(await (await Token.attach(tokens[i])).balanceOf(account));
        }
      }
      return {
        tokenBalances: balances
      }
    }

    snapshotId = await snapshot();
  });

  const createPool = async function (token0: string, token1: string, fee: number): Promise<ProAMMPool> {
    await factory.createPool(token0, token1, fee);
    let pool = (await ethers.getContractAt('ProAMMPool', await factory.getPool(token0, token1, fee))) as ProAMMPool;
    return pool;
  }

  describe('#unlockPool', async () => {
    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
    });

    it('correct tokens transfer from user to the pool', async () => {
      let firstTokens = [weth.address, tokenA.address, tokenB.address];
      let secondTokens = [tokenA.address, tokenB.address, weth.address];
      for (let i = 0 ; i < firstTokens.length; i++) {
        let fee = swapFeeBpsArray[i % swapFeeBpsArray.length];
        let initPrice = encodePriceSqrt(121, 100);
        let pool = await createPool(firstTokens[i], secondTokens[i], fee);

        let userBefore = await getBalances(user.address, [firstTokens[i], secondTokens[i]]);
        let poolBefore = await getBalances(pool.address, [firstTokens[i], secondTokens[i]]);

        await liquidityHelper.connect(user).testUnlockPool(firstTokens[i], secondTokens[i], fee, initPrice);

        let userAfter = await getBalances(user.address, [firstTokens[i], secondTokens[i]]);
        let poolAfter = await getBalances(pool.address, [firstTokens[i], secondTokens[i]]);

        expect(userBefore.tokenBalances[0].sub(userAfter.tokenBalances[0])).to.be.eq(
          poolAfter.tokenBalances[0].sub(poolBefore.tokenBalances[0])
        );
        expect(userBefore.tokenBalances[1].sub(userAfter.tokenBalances[1])).to.be.eq(
          poolAfter.tokenBalances[1].sub(poolBefore.tokenBalances[1])
        );
      }
    });

    it('can setup to unlock with eth', async () => {
      let fee = swapFeeBpsArray[0];
      let initPrice = encodePriceSqrt(121, 100);
      let pool = await createPool(weth.address, tokenA.address, fee);

      let userBefore = await getBalances(user.address, [ZERO_ADDRESS, weth.address, tokenA.address]);
      let poolBefore = await getBalances(pool.address, [ZERO_ADDRESS, weth.address, tokenA.address]);

      let multicallData = [liquidityHelper.interface.encodeFunctionData('testUnlockPool', [weth.address, tokenA.address, fee, initPrice])];
      multicallData.push(liquidityHelper.interface.encodeFunctionData('refundETH')); // refund redundant eth back to user

      let tx = await liquidityHelper.connect(user).multicall(multicallData, { value: PRECISION, gasPrice: txGasPrice });
      let txFee = txGasPrice.mul((await tx.wait()).gasUsed);

      let userAfter = await getBalances(user.address, [ZERO_ADDRESS, weth.address, tokenA.address]);
      let poolAfter = await getBalances(pool.address, [ZERO_ADDRESS, weth.address, tokenA.address]);

      expect(userBefore.tokenBalances[0].sub(userAfter.tokenBalances[0]).sub(txFee)).to.be.eq(
        poolAfter.tokenBalances[1].sub(poolBefore.tokenBalances[1])
      );
      expect(userBefore.tokenBalances[2].sub(userAfter.tokenBalances[2])).to.be.eq(
        poolAfter.tokenBalances[2].sub(poolBefore.tokenBalances[2])
      );
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
          token0: token0, token1: token1, fee: swapFeeBpsArray[0], recipient: user.address,
          tickLower: -100 * tickSpacingArray[0], tickUpper: 100 * tickSpacingArray[0],
          amount0Desired: PRECISION, amount1Desired: PRECISION, amount0Min: BN.from(0), amount1Min: BN.from(0)
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
          token0: token0, token1: token1, fee: swapFeeBpsArray[0], recipient: user.address,
          tickLower: -100 * tickSpacingArray[0], tickUpper: 100 * tickSpacingArray[0],
          amount0Desired: PRECISION, amount1Desired: PRECISION, amount0Min: PRECISION.add(ONE), amount1Min: BN.from(0)
        })
      ).to.be.revertedWith('LiquidityHelper: price slippage check');
      await expect(
        liquidityHelper.connect(user).testAddLiquidity({
          token0: token0, token1: token1, fee: swapFeeBpsArray[0], recipient: user.address,
          tickLower: -100 * tickSpacingArray[0], tickUpper: 100 * tickSpacingArray[0],
          amount0Desired: PRECISION, amount1Desired: PRECISION, amount0Min: BN.from(0), amount1Min: PRECISION.add(ONE)  
        })
      ).to.be.revertedWith('LiquidityHelper: price slippage check');
    });

    it('correct tokens transfer to pool', async () => {
      let firstTokens = [weth.address, tokenA.address, tokenB.address];
      let secondTokens = [tokenA.address, tokenB.address, weth.address];
      for (let i = 0 ; i < firstTokens.length; i++) {
        let index = i % swapFeeBpsArray.length;
        let fee = swapFeeBpsArray[index];

        let token0 = firstTokens[i] < secondTokens[i] ? firstTokens[i] : secondTokens[i];
        let token1 = firstTokens[i] < secondTokens[i] ? secondTokens[i] : firstTokens[i];

        let pool = await createPool(token0, token1, swapFeeBpsArray[index]);
        await liquidityHelper.connect(user).testUnlockPool(token0, token1, swapFeeBpsArray[index], initialPrice);

        let userBefore = await getBalances(user.address, [firstTokens[i], secondTokens[i]]);
        let poolBefore = await getBalances(pool.address, [firstTokens[i], secondTokens[i]]);

        await liquidityHelper.connect(user).testAddLiquidity({
          token0: token0, token1: token1, fee: fee, recipient: user.address,
          tickLower: -100 * tickSpacingArray[index], tickUpper: 100 * tickSpacingArray[index],
          amount0Desired: PRECISION, amount1Desired: PRECISION,
          amount0Min: BN.from(0), amount1Min: BN.from(0)  
        });

        let userAfter = await getBalances(user.address, [firstTokens[i], secondTokens[i]]);
        let poolAfter = await getBalances(pool.address, [firstTokens[i], secondTokens[i]]);

        expect(userBefore.tokenBalances[0].sub(userAfter.tokenBalances[0])).to.be.eq(
          poolAfter.tokenBalances[0].sub(poolBefore.tokenBalances[0])
        );
        expect(userBefore.tokenBalances[1].sub(userAfter.tokenBalances[1])).to.be.eq(
          poolAfter.tokenBalances[1].sub(poolBefore.tokenBalances[1])
        );
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
        token0: token0, token1: token1, fee: fee, recipient: user.address,
        tickLower: -100 * tickSpacingArray[0], tickUpper: 100 * tickSpacingArray[0],
        amount0Desired: PRECISION, amount1Desired: PRECISION,
        amount0Min: BN.from(0), amount1Min: BN.from(0)
      }

      let multicallData = [liquidityHelper.interface.encodeFunctionData('testAddLiquidity', [params])];
      multicallData.push(liquidityHelper.interface.encodeFunctionData('refundETH')); // refund redundant eth back to user

      let tx = await liquidityHelper.connect(user).multicall(multicallData, { value: PRECISION.mul(TWO), gasPrice: txGasPrice });
      let txFee = txGasPrice.mul((await tx.wait()).gasUsed);

      let userAfter = await getBalances(user.address, [ZERO_ADDRESS, weth.address, tokenA.address]);
      let poolAfter = await getBalances(pool.address, [ZERO_ADDRESS, weth.address, tokenA.address]);

      expect(userBefore.tokenBalances[0].sub(userAfter.tokenBalances[0]).sub(txFee)).to.be.eq(
        poolAfter.tokenBalances[1].sub(poolBefore.tokenBalances[1])
      );
      expect(userBefore.tokenBalances[2].sub(userAfter.tokenBalances[2])).to.be.eq(
        poolAfter.tokenBalances[2].sub(poolBefore.tokenBalances[2])
      );
    });
  });
});
