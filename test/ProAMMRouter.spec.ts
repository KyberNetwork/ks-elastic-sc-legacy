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

const showGasUsed = false;
const provider = ethers.provider;

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

let getBalances: (
  who: string
) => Promise<{
  ethBalance: BigNumber,
  tokenBalances: BigNumber[] // weth, tokenA, tokenB
}>

describe('ProAMMRouter', () => {
  const [user, admin] = waffle.provider.getWallets();

  before('factory, token and callback setup', async () => {
    Token = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    tokenA = await Token.deploy('USDC', 'USDC', BN.from(1000000).mul(PRECISION));
    tokenB = await Token.deploy('DAI', 'DAI', BN.from(1000000).mul(PRECISION));
    factory = await deployFactory(admin);

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

    await weth.connect(user).deposit({ value: PRECISION.mul(BN.from(10)) });
    await weth.connect(user).approve(router.address, BN.from(2).pow(255));
    await tokenA.connect(user).approve(router.address, BN.from(2).pow(255));
    await tokenB.connect(user).approve(router.address, BN.from(2).pow(255));

    snapshotId = await snapshot();

    getBalances = async (account: string) => {
      const balances = await Promise.all([
        weth.balanceOf(account),
        tokenA.balanceOf(account),
        tokenB.balanceOf(account),
      ]);
      return {
        ethBalance: await provider.getBalance(account),
        tokenBalances: balances
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

  const swapExactInputSingle = async function (
    tokenIn: string, tokenOut: string, fee: number, amount: BigNumber, initialPrice: BigNumber, useEth: boolean
  ): Promise<ContractTransaction> {
    let isSrcEth = tokenIn == weth.address && useEth;
    let isDestEth = tokenIn == weth.address && useEth;

    const swapParams = {
      tokenIn: tokenIn, tokenOut: tokenOut, fee: fee,
      recipient: user.address, deadline: BN.from(2).pow(255),
      amountIn: amount, amountOutMinimum: BN.from(0),
      sqrtPriceLimitX96: initialPrice
    };
    if (isDestEth) swapParams.recipient = ZERO_ADDRESS; // keep weth at router

    let multicallData = [router.interface.encodeFunctionData('swapExactInputSingle', [swapParams])];
    if (isSrcEth) multicallData.push(router.interface.encodeFunctionData('refundETH', []));
    if (isDestEth) multicallData.push(router.interface.encodeFunctionData('unwrapWETH', [0, user.address]));

    let tx = await router
      .connect(user)
      .multicall(multicallData, { value: isSrcEth ? amount : BN.from(0) });

    return tx;
  }

  const swapExactInput = async function (
    tokens: string[], fee: number, amount: BigNumber, useEth: boolean
  ): Promise<ContractTransaction> {
    let isSrcEth = tokens[0] == weth.address && useEth;
    let isDestEth = tokens[tokens.length - 1] == weth.address && useEth;

    const swapParams = {
      path: encodePath(tokens, new Array(tokens.length - 1).fill(fee)),
      recipient: user.address, deadline: BN.from(2).pow(255),
      amountIn: amount, amountOutMinimum: BN.from(0)
    };
    if (isDestEth) swapParams.recipient = ZERO_ADDRESS; // keep weth at router

    let multicallData = [router.interface.encodeFunctionData('swapExactInput', [swapParams])];
    if (isSrcEth) multicallData.push(router.interface.encodeFunctionData('refundETH', []));
    if (isDestEth) multicallData.push(router.interface.encodeFunctionData('unwrapWETH', [0, user.address]));

    let tx = await router
      .connect(user)
      .multicall(multicallData, { value: isSrcEth ? amount : BN.from(0) });
    return tx;
  }

  const swapExactOutputSingle = async function (
    tokenIn: string, tokenOut: string, fee: number, amount: BigNumber, initialPrice: BigNumber, useEth: boolean
  ): Promise<ContractTransaction> {
    let isSrcEth = tokenIn == weth.address && useEth;
    let isDestEth = tokenIn == weth.address && useEth;

    const swapParams = {
      tokenIn: tokenIn, tokenOut: tokenOut, fee: fee,
      recipient: user.address, deadline: BN.from(2).pow(255),
      amountOut: amount, amountInMaximum: PRECISION,
      sqrtPriceLimitX96: initialPrice
    }
    if (isDestEth) swapParams.recipient = ZERO_ADDRESS; // keep weth at router

    let multicallData = [router.interface.encodeFunctionData('swapExactOutputSingle', [swapParams])];
    if (isSrcEth) multicallData.push(router.interface.encodeFunctionData('refundETH', []));
    if (isDestEth) multicallData.push(router.interface.encodeFunctionData('unwrapWETH', [0, user.address]));

    let tx = await router
      .connect(user)
      .multicall(multicallData, { value: isSrcEth ? PRECISION : BN.from(0) });
    return tx;
  }

  const swapExactOutput = async function (
    tokens: string[], fee: number, amount: BigNumber, useEth: boolean
  ): Promise<ContractTransaction> {
    let isSrcEth = tokens[0] == weth.address && useEth;
    let isDestEth = tokens[tokens.length - 1] == weth.address && useEth;
    let encodeTokens = tokens.slice().reverse();

    const swapParams = {
      path: encodePath(encodeTokens, new Array(encodeTokens.length - 1).fill(fee)),
      recipient: user.address, deadline: BN.from(2).pow(255),
      amountOut: amount, amountInMaximum: PRECISION,
      }
    if (isDestEth) swapParams.recipient = ZERO_ADDRESS; // keep weth at router

    let multicallData = [router.interface.encodeFunctionData('swapExactOutput', [swapParams])];
    if (isSrcEth) multicallData.push(router.interface.encodeFunctionData('refundETH', []));
    if (isDestEth) multicallData.push(router.interface.encodeFunctionData('unwrapWETH', [0, user.address]));
    let tx = await router
      .connect(user)
      .multicall(multicallData, { value: isSrcEth ? PRECISION : BN.from(0) });
    return tx;
  }

  describe('#swapExactInputSingle', async () => {
    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
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
        tx = await swapExactInputSingle(
          token0.address, token1.address, swapFeeBpsArray[i], PRECISION, await getPriceFromTick(tickLower), false
        );
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
        // token1 -> token0
        tx = await swapExactInputSingle(
          token1.address, token0.address, swapFeeBpsArray[i], PRECISION, await getPriceFromTick(tickUpper), false
        );
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      }
      if (showGasUsed) {
        console.log(`Average gas used for ${numRuns * 2} swapExactInputSingle: ${gasUsed.div(BN.from(numRuns * 2)).toString()}`)
      }
    });

    it('eth -> token', async () => {
      let fee = swapFeeBpsArray[0];
      await setupPool(weth.address, tokenB.address, fee, initialPrice, ticks);
      await swapExactInputSingle(
        weth.address, tokenB.address, fee, BN.from(10000000), BN.from(0), true
      );
    });

    it('token -> eth', async () => {
      let fee = swapFeeBpsArray[0];
      await setupPool(weth.address, tokenB.address, fee, initialPrice, ticks);
      await swapExactInputSingle(
        tokenB.address, weth.address, fee, BN.from(10000000), BN.from(0), true
      );
    });

    it('test reverts', async () => {
      let fee = swapFeeBpsArray[0];
      let amount = BN.from(1000000);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      await expect(
        router.connect(user).swapExactInputSingle({
          tokenIn: tokenA.address, tokenOut: tokenB.address, fee: fee,
          recipient: user.address, deadline: BN.from(2).pow(255),
          amountIn: amount, amountOutMinimum: PRECISION,
          sqrtPriceLimitX96: BN.from(0)
        })
      ).to.be.revertedWith('ProAMMRouter: insufficient amount out');
    });
  });

  describe('#swapExactOutputSingle', async () => {
    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
    });

    it('token - token', async () => {
      let gasUsed = BN.from(0);
      let numRuns = swapFeeBpsArray.length;
      for (let i = 0; i < 1; i++) {
        await setupPool(tokenA.address, tokenB.address, swapFeeBpsArray[i], initialPrice, ticks);
        let tx = await swapExactOutputSingle(
          tokenA.address, tokenB.address, swapFeeBpsArray[i], BN.from(1000000), BN.from(0), false
        );
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
        tx = await swapExactOutputSingle(
          tokenB.address, tokenA.address, swapFeeBpsArray[i], BN.from(1000000), BN.from(0), false
        );
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      }
      if (showGasUsed) {
        console.log(`Average gas used for ${numRuns * 2} swapExactOutSingle: ${gasUsed.div(BN.from(numRuns * 2)).toString()}`)
      }
    });

    it('eth -> token', async () => {
      let fee = swapFeeBpsArray[0];
      await setupPool(weth.address, tokenB.address, fee, initialPrice, ticks);
      // eth -> tokenB
      await swapExactOutputSingle(
        weth.address, tokenB.address, fee, BN.from(10000000), BN.from(0), true
      );
    });

    it('token -> eth', async () => {
      let fee = swapFeeBpsArray[0];
      await setupPool(weth.address, tokenB.address, fee, initialPrice, ticks);
      await swapExactOutputSingle(
        tokenB.address, weth.address, fee, BN.from(10000000), BN.from(0), true
      );
    });

    it('test reverts', async () => {
      let fee = swapFeeBpsArray[0];
      let amount = BN.from(1000000);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      await expect(
        router.connect(user).swapExactOutputSingle({
          tokenIn: tokenA.address, tokenOut: tokenB.address, fee: fee,
          recipient: user.address, deadline: BN.from(2).pow(255),
          amountOut: amount, amountInMaximum: BN.from(0),
          sqrtPriceLimitX96: BN.from(0)
        })
      ).to.be.revertedWith('ProAMMRouter: amountIn is too high');
    });
  });

  describe(`#swapExactInput`, async () => {
    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
    });

    it('one pool', async () => {
      let firstTokens = [weth.address, tokenA.address];
      let secondTokens = [tokenA.address, tokenB.address];
      let gasUsed = BN.from(0);
      let fee = swapFeeBpsArray[0];
      let numRuns = firstTokens.length;
      for(let i = 0; i < numRuns; i++) {
        await setupPool(firstTokens[i], secondTokens[i], fee, initialPrice, ticks);
        let tx = await swapExactInput([firstTokens[i], secondTokens[i]], fee, BN.from(10000000), false);
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
        tx = await swapExactInput([secondTokens[i], firstTokens[i]], fee, BN.from(10000000), false);
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      }
      if (showGasUsed) {
        console.log(`Average gas used for ${numRuns * 2} swapExactIn: ${(gasUsed.div(BN.from(numRuns * 2))).toString()}`);
      }
    });

    it('2 pools', async () => {
      let fee = swapFeeBpsArray[0];
      let gasUsed = BN.from(0);
      let amount = BN.from(1000000);
      await setupPool(weth.address, tokenA.address, fee, initialPrice, ticks);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      // swap eth -> tokenA -> tokenB
      let tx = await swapExactInput(
        [weth.address, tokenA.address, tokenB.address], fee, amount, false
      );
      gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      // swap tokenB -> tokenA -> eth
      tx = await swapExactInput(
        [tokenB.address, tokenA.address, weth.address], fee, amount, false
      );
      gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      if (showGasUsed) {
        console.log(`Average gas used for 2 swapExactIn 2 pools: ${(gasUsed.div(BN.from(2))).toString()}`);
      }
    });

    it('eth -> token', async () => {
      let fee = swapFeeBpsArray[0];
      await setupPool(weth.address, tokenB.address, fee, initialPrice, ticks);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      // eth -> tokenB -> tokenA
      await swapExactInput(
        [weth.address, tokenB.address, tokenA.address], fee, BN.from(1000000), true
      );
    });

    it('token -> eth', async () => {
      let fee = swapFeeBpsArray[0];
      await setupPool(weth.address, tokenB.address, fee, initialPrice, ticks);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      await swapExactInput(
        [tokenA.address, tokenB.address, weth.address], fee, BN.from(1000000), true
      );
    });

    it('test reverts', async () => {
      let fee = swapFeeBpsArray[0];
      let amount = BN.from(1000000);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      await setupPool(tokenB.address, weth.address, fee, initialPrice, ticks);
      await expect(
        router.connect(user).swapExactInput({
          path: encodePath([tokenA.address, tokenB.address, weth.address], [fee, fee]),
          recipient: user.address, deadline: BN.from(2).pow(255),
          amountIn: amount, amountOutMinimum: PRECISION
        })
      ).to.be.revertedWith('ProAMMRouter: insufficient amount out')
    });
  });

  describe(`#swapExactOutput`, async () => {
    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
    });

    it('one pool', async () => {
      let firstTokens = [weth.address, tokenA.address];
      let secondTokens = [tokenA.address, tokenB.address];
      let gasUsed = BN.from(0);
      let fee = swapFeeBpsArray[0];
      let numRuns = firstTokens.length;
      for(let i = 0; i < numRuns; i++) {
        await setupPool(firstTokens[i], secondTokens[i], fee, initialPrice, ticks);
        let tx = await swapExactOutput([firstTokens[i], secondTokens[i]], fee, BN.from(10000000), false);
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
        tx = await swapExactOutput([secondTokens[i], firstTokens[i]], fee, BN.from(10000000), false);
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      }
      if (showGasUsed) {
        console.log(`Average gas used for ${numRuns * 2} swapExactOut: ${(gasUsed.div(BN.from(numRuns * 2))).toString()}`);
      }
    });

    it('2 pools', async () => {
      let fee = swapFeeBpsArray[0];
      let gasUsed = BN.from(0);
      let amount = BN.from(1000000);
      await setupPool(weth.address, tokenA.address, fee, initialPrice, ticks);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      // swap eth -> tokenA -> tokenB
      let tx = await swapExactOutput(
        [weth.address, tokenA.address, tokenB.address], fee, amount, false
      );
      gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      // swap tokenB -> tokenA -> eth
      tx = await swapExactOutput(
        [tokenB.address, tokenA.address, weth.address], fee, amount, false
      );
      gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      if (showGasUsed) {
        console.log(`Average gas used for 2 swapExactIn 2 pools: ${(gasUsed.div(BN.from(2))).toString()}`);
      }
    });

    it('eth -> token', async () => {
      let fee = swapFeeBpsArray[0];
      await setupPool(weth.address, tokenB.address, fee, initialPrice, ticks);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      // eth -> tokenB -> tokenA
      await swapExactOutput(
        [weth.address, tokenB.address, tokenA.address], fee, BN.from(1000000), true
      );
    });

    it('token -> eth', async () => {
      let fee = swapFeeBpsArray[0];
      await setupPool(weth.address, tokenB.address, fee, initialPrice, ticks);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      await swapExactOutput(
        [tokenA.address, tokenB.address, weth.address], fee, BN.from(1000000), true
      );
    });

    it('test reverts', async () => {
      let fee = swapFeeBpsArray[0];
      let amount = BN.from(1000000);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      await setupPool(tokenB.address, weth.address, fee, initialPrice, ticks);
      await expect(
        router.connect(user).swapExactOutput({
          path: encodePath([tokenA.address, tokenB.address, weth.address], [fee, fee]),
          recipient: user.address, deadline: BN.from(2).pow(255),
          amountOut: amount, amountInMaximum: BN.from(0),
        })
      ).to.be.revertedWith('ProAMMRouter: amountIn is too high');
    });
  });

  describe(`#others`, async () => {
    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
    });

    it('swap a loop with 3 pools', async () => {
      let fee = swapFeeBpsArray[0];
      let amount = BN.from(1000000);
      await setupPool(weth.address, tokenA.address, fee, initialPrice, ticks);
      await setupPool(weth.address, tokenB.address, fee, initialPrice, ticks);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      await swapExactInput(
        [weth.address, tokenA.address, tokenB.address, weth.address], fee, amount, false
      );
      await swapExactInput(
        [tokenA.address, weth.address, tokenB.address, tokenA.address], fee, amount, false
      );
      await swapExactOutput(
        [tokenB.address, tokenA.address, weth.address, tokenB.address], fee, amount, false
      );
    });

    it('callback: invalid data', async () => {
      await expect(
        router.connect(user).proAMMSwapCallback(0, 0, "0x")
      ).to.be.revertedWith('ProAMMRouter: invalid delta qties');
      await expect(
        router.connect(user).proAMMSwapCallback(-1, 0, "0x")
      ).to.be.revertedWith('ProAMMRouter: invalid delta qties');
      await expect(
        router.connect(user).proAMMSwapCallback(0, -1, "0x")
      ).to.be.revertedWith('ProAMMRouter: invalid delta qties');
    });

    it('swap: expiry', async () => {
      let fee = swapFeeBpsArray[0];
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      let amount = BN.from(100000);
      let swapParams = {};
      swapParams = {
        tokenIn: tokenA.address, tokenOut: tokenB.address, fee: fee,
        recipient: user.address, deadline: BN.from(0),
        amountIn: amount, amountOutMinimum: BN.from(0),
        sqrtPriceLimitX96: initialPrice
      };
      await expect(
        router.connect(user).swapExactInputSingle(swapParams)
      ).to.be.revertedWith('ProAMM: Expired');
      swapParams = {
        path: encodePath([tokenA.address, tokenB.address], [fee]),
        recipient: user.address, deadline: BN.from(0),
        amountIn: amount, amountOutMinimum: BN.from(0)
      };
      await expect(
        router.connect(user).swapExactInput(swapParams)
      ).to.be.revertedWith('ProAMM: Expired');
      swapParams = {
        tokenIn: tokenA.address, tokenOut: tokenB.address, fee: fee,
        recipient: user.address, deadline: BN.from(0),
        amountOut: amount, amountInMaximum: PRECISION,
        sqrtPriceLimitX96: initialPrice
      };
      await expect(
        router.connect(user).swapExactOutputSingle(swapParams)
      ).to.be.revertedWith('ProAMM: Expired');
      swapParams = {
        path: encodePath([tokenA.address, tokenB.address], [fee]),
        recipient: user.address, deadline: BN.from(0),
        amountOut: amount, amountInMaximum: PRECISION,
      };
      await expect(
        router.connect(user).swapExactOutput(swapParams)
      ).to.be.revertedWith('ProAMM: Expired');
    });
  });
});
