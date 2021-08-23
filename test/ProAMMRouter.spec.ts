import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {Wallet, BigNumber, ContractTransaction} from 'ethers';
import {BN, PRECISION, ZERO_ADDRESS, MIN_SQRT_RATIO, ONE, TWO, MIN_LIQUIDITY, MAX_SQRT_RATIO, TWO_POW_96} from './helpers/helper';
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
import {encodePath} from './helpers/swapPath.ts';

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
let initialPrice: BigNumber;
let ticks: number[];

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

    initialPrice = encodePriceSqrt(1, 1);
    ticks = [-100 * tickSpacingArray[0], 100 * tickSpacingArray[0]];
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
  ): Promise<ProAMMPool> {
    await setupCallback(await Token.attach(token0), await Token.attach(token1));
    await factory.createPool(token0, token1, fee);
    let pool = (await ethers.getContractAt('ProAMMPool', await factory.getPool(token0, token1, fee))) as ProAMMPool;
    await callback.connect(user).unlockPool(pool.address, poolSqrtPrice, '0x');
    await callback.connect(user).mint(
      pool.address, user.address,
      ticks[0], ticks[1],
      PRECISION.mul(BN.from(10)), '0x'
    );
    return pool;
  }

  const swapExactInSingleAndVerify = async function (
    tokenIn: string, tokenOut: string, fee: number, amount: BigNumber, initialPrice: BigNumber
  ): Promise<ContractTransaction> {
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

  const swapExactInAndVerify = async function (
    tokens: string[], fee: number, amount: BigNumber
  ): Promise<ContractTransaction> {
    let tx = await router
      .connect(user)
      .swapExactInput({
        path: encodePath(tokens, new Array(tokens.length - 1).fill(fee)),
        recipient: user.address, deadline: BN.from(2).pow(255),
        amountIn: amount, amountOutMinimum: BN.from(0)
        },
        { value: tokens[0] == weth.address ? amount : BN.from(0) }
      );
    return tx;
  }

  const swapExactOutSingleAndVerify = async function (
    tokenIn: string, tokenOut: string, fee: number, amount: BigNumber, initialPrice: BigNumber
  ): Promise<ContractTransaction> {
    const swapParams = {
      tokenIn: tokenIn, tokenOut: tokenOut, fee: fee,
      recipient: user.address, deadline: BN.from(2).pow(255),
      amountOut: amount, amountInMaximum: PRECISION,
      sqrtPriceLimitX96: initialPrice
    }
    let multicallData = [router.interface.encodeFunctionData('swapExactOutputSingle', [swapParams])];
    if (tokenIn == weth.address) multicallData.push(router.interface.encodeFunctionData('refundETH', []));
    let tx = await router
      .connect(user)
      .multicall(multicallData,
        { value: tokenIn == weth.address ? PRECISION : BN.from(0) }
      );
    return tx;
  }

  const swapExactOutAndVerify = async function (
    tokens: string[], fee: number, amount: BigNumber
  ): Promise<ContractTransaction> {
    let encodeTokens = tokens.slice().reverse();
    const swapParams = {
      path: encodePath(encodeTokens, new Array(encodeTokens.length - 1).fill(fee)),
      recipient: user.address, deadline: BN.from(2).pow(255),
      amountOut: amount, amountInMaximum: PRECISION,
      }
    let multicallData = [router.interface.encodeFunctionData('swapExactOutput', [swapParams])];
    if (tokens[0] == weth.address) multicallData.push(router.interface.encodeFunctionData('refundETH', []));
    let tx = await router
      .connect(user)
      .multicall(multicallData,
        { value: tokens[0] == weth.address ? PRECISION : BN.from(0) }
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

    it('swapExactIn: eth - token', async () => {
      let gasUsed = BN.from(0);
      let numRuns = swapFeeBpsArray.length;
      for (let i = 0; i < numRuns; i++) {
        await setupPool(
          weth.address, tokenB.address, swapFeeBpsArray[i],
          initialPrice, [-100 * tickSpacingArray[i], 100 * tickSpacingArray[i]]
        );
        // swap eth -> token
        let tx = await swapExactInSingleAndVerify(
          weth.address, tokenB.address, swapFeeBpsArray[i], BN.from(10000000), BN.from(0)
        );
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
        // swap token -> weth
        tx = await swapExactInSingleAndVerify(
          tokenB.address, weth.address, swapFeeBpsArray[i], BN.from(10000000), BN.from(0)
        );
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      }
      console.log(`Average gas used for ${numRuns * 2} swapExactInSingle: ${(gasUsed.div(BN.from(numRuns * 2))).toString()}`);
    });

    it('swapExactIn: token - token', async () => {
      let gasUsed = BN.from(0);
      let numRuns = swapFeeBpsArray.length;
      for (let i = 0; i < numRuns; i++) {
        let tickLower = -200 * tickSpacingArray[i];
        let tickUpper = 100 * tickSpacingArray[i];
        await setupPool(
          tokenA.address, tokenB.address, swapFeeBpsArray[i],
          initialPrice, [tickLower, tickUpper]
        );
        let token0 = tokenA.address < tokenB.address ? tokenA : tokenB;
        let token1 = tokenA.address < tokenB.address ? tokenB : tokenA;
        let tx;
        // token0 -> token1
        tx = await swapExactInSingleAndVerify(
          token0.address, token1.address, swapFeeBpsArray[i], PRECISION, await getPriceFromTick(tickLower)
        );
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
        // token1 -> token0
        tx = await swapExactInSingleAndVerify(
          token1.address, token0.address, swapFeeBpsArray[i], PRECISION, await getPriceFromTick(tickUpper)
        );
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      }
      console.log(`Average gas used for ${numRuns * 2} swapExactInSingle: ${gasUsed.div(BN.from(numRuns * 2)).toString()}`)
    });

    it('swapExactOut: token - token', async () => {
      let gasUsed = BN.from(0);
      let numRuns = swapFeeBpsArray.length;
      for (let i = 0; i < 1; i++) {
        await setupPool(tokenA.address, tokenB.address, swapFeeBpsArray[i], initialPrice, ticks);
        let tx = await swapExactOutSingleAndVerify(
          tokenA.address, tokenB.address, swapFeeBpsArray[i], BN.from(1000000), BN.from(0)
        );
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
        tx = await swapExactOutSingleAndVerify(
          tokenB.address, tokenA.address, swapFeeBpsArray[i], BN.from(1000000), BN.from(0)
        );
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      }
      console.log(`Average gas used for ${numRuns * 2} swapExactOutSingle: ${gasUsed.div(BN.from(numRuns * 2)).toString()}`)
    });
  });

  describe('Test swap multiple pools', async () => {
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

    it('swapExactIn with only one pool', async () => {
      let firstTokens = [weth.address, tokenA.address];
      let secondTokens = [tokenA.address, tokenB.address];
      let gasUsed = BN.from(0);
      let fee = swapFeeBpsArray[0];
      let numRuns = firstTokens.length;
      for(let i = 0; i < numRuns; i++) {
        await setupPool(firstTokens[i], secondTokens[i], fee, initialPrice, ticks);
        let tx = await swapExactInAndVerify([firstTokens[i], secondTokens[i]], fee, BN.from(10000000));
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
        tx = await swapExactInAndVerify([secondTokens[i], firstTokens[i]], fee, BN.from(10000000));
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      }
      console.log(`Average gas used for ${numRuns * 2} swapExactIn: ${(gasUsed.div(BN.from(numRuns * 2))).toString()}`);
    });

    it('swapExactOut with only one pool', async () => {
      let firstTokens = [weth.address, tokenA.address];
      let secondTokens = [tokenA.address, tokenB.address];
      let gasUsed = BN.from(0);
      let fee = swapFeeBpsArray[0];
      let numRuns = firstTokens.length;
      for(let i = 0; i < numRuns; i++) {
        await setupPool(firstTokens[i], secondTokens[i], fee, initialPrice, ticks);
        let tx = await swapExactOutAndVerify([firstTokens[i], secondTokens[i]], fee, BN.from(10000000));
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
        tx = await swapExactOutAndVerify([secondTokens[i], firstTokens[i]], fee, BN.from(10000000));
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      }
      console.log(`Average gas used for ${numRuns * 2} swapExactOut: ${(gasUsed.div(BN.from(numRuns * 2))).toString()}`);
    });

    it('swapExactIn 2 pools', async () => {
      let fee = swapFeeBpsArray[0];
      let gasUsed = BN.from(0);
      let amount = BN.from(1000000);
      await setupPool(weth.address, tokenA.address, fee, initialPrice, ticks);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      // swap eth -> tokenA -> tokenB
      let tx = await swapExactInAndVerify(
        [weth.address, tokenA.address, tokenB.address], fee, amount
      );
      gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      // swap tokenB -> tokenA -> eth
      tx = await swapExactInAndVerify(
        [tokenB.address, tokenA.address, weth.address], fee, amount
      );
      gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      console.log(`Average gas used for 2 swapExactIn 2 pools: ${(gasUsed.div(BN.from(2))).toString()}`);
    });

    it('swapExactOut 2 pools', async () => {
      let fee = swapFeeBpsArray[0];
      let gasUsed = BN.from(0);
      let amount = BN.from(1000000);
      await setupPool(weth.address, tokenA.address, fee, initialPrice, ticks);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      // swap eth -> tokenA -> tokenB
      let tx = await swapExactOutAndVerify(
        [weth.address, tokenA.address, tokenB.address], fee, amount
      );
      gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      // swap tokenB -> tokenA -> eth
      tx = await swapExactOutAndVerify(
        [tokenB.address, tokenA.address, weth.address], fee, amount
      );
      gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      console.log(`Average gas used for 2 swapExactIn 2 pools: ${(gasUsed.div(BN.from(2))).toString()}`);
    });

    it('swap a loop with 3 pools', async () => {
      let fee = swapFeeBpsArray[0];
      let amount = BN.from(1000000);
      let ticks = [-100 * tickSpacingArray[0], tickSpacingArray[0] * 200];
      await setupPool(weth.address, tokenA.address, fee, initialPrice, ticks);
      await setupPool(weth.address, tokenB.address, fee, initialPrice, ticks);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      await swapExactInAndVerify(
        [weth.address, tokenA.address, tokenB.address, weth.address], fee, amount
      );
      await swapExactInAndVerify(
        [tokenA.address, weth.address, tokenB.address, tokenA.address], fee, amount
      );
      await swapExactOutAndVerify(
        [tokenB.address, tokenA.address, weth.address, tokenB.address], fee, amount
      );
    })
  });
});
