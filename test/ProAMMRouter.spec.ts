import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {Wallet, BigNumber} from 'ethers';
import {BN, PRECISION, ZERO_ADDRESS, MIN_SQRT_RATIO, ONE, TWO, MAX_SQRT_RATIO} from './helpers/helper';
import {encodePriceSqrt, getPriceFromTick, getNearestSpacedTickAtPrice} from './helpers/utils';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {
  ProAMMRouter, ProAMMRouter__factory,
  ProAMMFactory, ProAMMPool,
  MockToken, MockToken__factory,
  MockWeth, MockWeth__factory,
  MockProAMMCallbacks,
  MockProAMMCallbacks__factory
} from '../typechain';
import {deployFactory} from './helpers/proAMMSetup';
import {snapshot, revertToSnapshot} from './helpers/hardhat';
import { MockToken, MockToken } from '../typechain/MockToken';
import { strict } from 'assert';

let Token: MockToken__factory;
let Callback: MockProAMMCallbacks__factory;
let admin;
let user;
let factory: ProAMMFactory;
let tokenA: MockToken;
let tokenB: MockToken;
let token0: MockToken;
let token1: MockToken;
let poolArray: ProAMMPool[] = [];
let pool: ProAMMPool;
let weth: MockWeth;
let router: ProAMMRouter;
let callback: MockProAMMCallbacks;
let swapFeeBpsArray = [5, 30];
let tickSpacingArray = [10, 60];

let firstSnapshot: any;
let snapshotId: any;

describe('ProAMMRouter', () => {
  const [user, admin] = waffle.provider.getWallets();

  before('factory, token and callback setup', async () => {
    Token = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    tokenA = await Token.deploy('USDC', 'USDC', BN.from(1000000).mul(PRECISION));
    tokenB = await Token.deploy('DAI', 'DAI', BN.from(1000000).mul(PRECISION));
    factory = await deployFactory(ethers, admin, ZERO_ADDRESS, ZERO_ADDRESS);

    const WETH = (await ethers.getContractFactory('MockWeth')) as MockWeth__factory;
    weth = await WETH.deploy();
    const Router = (await ethers.getContractFactory('ProAMMRouter')) as ProAMMRouter__factory;
    router = await Router.deploy(factory.address, weth.address);

    // use callback to add liquidity
    Callback = await ethers.getContractFactory('MockProAMMCallbacks') as MockProAMMCallbacks__factory;

    // add any newly defined tickSpacing apart from default ones
    for (let i = 0; i < swapFeeBpsArray.length; i++) {
      if ((await factory.feeAmountTickSpacing(swapFeeBpsArray[i])) == 0) {
        await factory.connect(admin).enableSwapFee(swapFeeBpsArray[i], tickSpacingArray[i]);
      }
    }
  });

  const setupCallback = async function (tokenA: MockToken, tokenB: MockToken) {
    callback = (await Callback.deploy(tokenA.address, tokenB.address)) as MockProAMMCallbacks;
    await callback.changeUser(user.address);
    await tokenA.connect(user).approve(callback.address, BN.from(2).pow(BN.from(255)));
    await tokenB.connect(user).approve(callback.address, BN.from(2).pow(BN.from(255)));
  }

  const setupPool = async function (
    token0: string, token1: string, fee: number,
    poolSqrtPrice: BigNumber, ticks: number[]
  ) {
    await factory.createPool(token0, token1, fee);
    let pool = (await ethers.getContractAt('ProAMMPool', await factory.getPool(token0, token1, fee))) as ProAMMPool;
    console.log(`Token 0 balance: ${(await (await Token.attach(token0)).balanceOf(pool.address)).toString()}`);
    console.log(`Token 1 balance: ${(await (await Token.attach(token1)).balanceOf(pool.address)).toString()}`);
    await callback.connect(user).unlockPool(pool.address, poolSqrtPrice, '0x');
    await callback.connect(user).mint(
      pool.address, user.address,
      ticks[0], ticks[1],
      PRECISION, '0x'
    );
    console.log(`Token 0 balance: ${(await (await Token.attach(token0)).balanceOf(pool.address)).toString()}`);
    console.log(`Token 1 balance: ${(await (await Token.attach(token1)).balanceOf(pool.address)).toString()}`);
    return pool;
  }

  const swapExactInAndVerify = async function (
    tokenIn: string, tokenOut: string, fee: number, amount: BigNumber, initialPrice: BigNumber
  ) {
    let tx = await router
      .connect(user)
      .swapExactInputSingle({
        tokenIn: tokenIn, tokenOut: tokenOut, fee: fee,
        recipient: user.address, deadline: BN.from(2).pow(255),
        amountIn: amount, amountOutMinimum: BN.from(0),
        sqrtPriceLimitX96: initialPrice
        },
        { value: tokenIn == weth.address ? amount : BN.from(0) }
      );
    return tx;
  }

  const swapExactOutAndVerify = async function (
    tokenIn: string, tokenOut: string, fee: number, amount: BigNumber, initialPrice: BigNumber
  ) {
    let tx = await router
      .connect(user)
      .swapExactOutputSingle({
        tokenIn: tokenIn, tokenOut: tokenOut, fee: fee,
        recipient: user.address, deadline: BN.from(2).pow(255),
        amountOut: amount, amountInMaximum: BN.from(2).pow(255),
        sqrtPriceLimitX96: initialPrice
        }
      );

    return tx;
  }

  describe('Test swap single pool', async () => {
    before('deploy pools and take snapshot', async () => {
      // for revert to before pool creation
      firstSnapshot = await snapshot();
      await weth.connect(user).deposit({ value: PRECISION.mul(BN.from(10)) });
      await tokenA.connect(user).approve(router.address, BN.from(2).pow(255));
      await tokenB.connect(user).approve(router.address, BN.from(2).pow(255));
      snapshotId = await snapshot();
    });

    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
    });

    after('revert to first snapshot', async () => {
      await revertToSnapshot(firstSnapshot);
      poolArray = [];
    });

    it.skip('swapExactIn: eth - token', async () => {
      await setupCallback(await Token.attach(weth.address), tokenB);
      let gasUsed = BN.from(0);
      let numRuns = swapFeeBpsArray.length;
      let initialPrice = encodePriceSqrt(3000, 1);
      for (let i = 0; i < numRuns; i++) {
        await setupPool(
          weth.address, tokenB.address, swapFeeBpsArray[i],
          initialPrice, [-10 * tickSpacingArray[i], tickSpacingArray[i] * 10]
        );
        // swap eth -> token
        let tx = await swapExactInAndVerify(weth.address, tokenB.address, swapFeeBpsArray[i], PRECISION, MIN_SQRT_RATIO.add(ONE));
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
        // swap token -> weth
        tx = await swapExactInAndVerify(tokenB.address, weth.address, swapFeeBpsArray[i], PRECISION, MIN_SQRT_RATIO.add(ONE));
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      }
      console.log(`Average gas used for ${numRuns * 2} swaps: ${(gasUsed.div(BN.from(numRuns * 2))).toString()}`);
    });

    it('swapExactIn: token - token', async () => {
      await setupCallback(tokenA, tokenB);
      let gasUsed = BN.from(0);
      let numRuns = swapFeeBpsArray.length;

      let initialPrice = encodePriceSqrt(1, 1);

      for (let i = 0; i < numRuns; i++) {
        let nearestTickToPrice = (await getNearestSpacedTickAtPrice(initialPrice, tickSpacingArray[i])).toNumber();
        let tickLower = nearestTickToPrice - 2 * tickSpacingArray[i];
        let tickUpper = nearestTickToPrice + 2 * tickSpacingArray[i];
        await setupPool(
          tokenA.address, tokenB.address, swapFeeBpsArray[i],
          initialPrice, [tickLower, tickUpper]
        );
        let token0 = tokenA.address < tokenB.address ? tokenA : tokenB;
        let token1 = tokenA.address < tokenB.address ? tokenB : tokenA;
        let tx;
        // token0 -> token1
        // console.log(`Token0 balance: ${(await token0.balanceOf(user.address)).toString()}`);
        tx = await swapExactInAndVerify(token0.address, token1.address, swapFeeBpsArray[i], PRECISION, await getPriceFromTick(tickLower));
        // console.log(`Token0 balance: ${(await token0.balanceOf(user.address)).toString()}`);
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
        // token1 -> token0
        // console.log(`Token1 balance: ${(await token1.balanceOf(user.address)).toString()}`);
        tx = await swapExactInAndVerify(token1.address, token0.address, swapFeeBpsArray[i], PRECISION, await getPriceFromTick(tickUpper));
        // console.log(`Token1 balance: ${(await token1.balanceOf(user.address)).toString()}`);
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      }
      console.log(`Average gas used for ${numRuns * 2} swapExactIn: ${gasUsed.div(BN.from(numRuns * 2)).toString()}`)
    });

    it('swapExactOut: token - token', async () => {
      await setupCallback(tokenA, tokenB);
      let gasUsed = BN.from(0);
      let numRuns = swapFeeBpsArray.length;

      let initialPrice = encodePriceSqrt(1, 1);

      for (let i = 0; i < numRuns; i++) {
        let nearestTickToPrice = (await getNearestSpacedTickAtPrice(initialPrice, tickSpacingArray[i])).toNumber();
        let tickLower = nearestTickToPrice - 10 * tickSpacingArray[i];
        let tickUpper = nearestTickToPrice + 10 * tickSpacingArray[i];
        await setupPool(
          tokenA.address, tokenB.address, swapFeeBpsArray[i],
          initialPrice, [tickLower, tickUpper]
        );
        let token0 = tokenA.address < tokenB.address ? tokenA : tokenB;
        let token1 = tokenA.address < tokenB.address ? tokenB : tokenA;
        let tx;
        // token0 -> token1
        tx = await swapExactOutAndVerify(token0.address, token1.address, swapFeeBpsArray[i], PRECISION, BN.from(0));
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
        // token1 -> token0
        tx = await swapExactOutAndVerify(token1.address, token0.address, swapFeeBpsArray[i], PRECISION, BN.from(0));
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      }
      console.log(`Average gas used for ${numRuns * 2} swapExactOut: ${gasUsed.div(BN.from(numRuns * 2)).toString()}`)
    });
  });
});
