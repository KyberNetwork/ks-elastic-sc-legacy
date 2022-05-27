import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {BigNumber as BN, ContractTransaction} from 'ethers';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {Router, Router__factory} from '../../typechain';
import {Factory, Pool} from '../../typechain';
import {MockToken, MockToken__factory, MockWeth, MockWeth__factory, MockEncoder} from '../../typechain';
import {MockCallbacks, MockCallbacks__factory} from '../../typechain';

import {deployFactory} from '../helpers/setup';
import {snapshot, revertToSnapshot} from '../helpers/hardhat';
import {encodePath} from '../helpers/swapPath';
import {PRECISION, ZERO, ZERO_ADDRESS, MAX_UINT, MIN_TICK} from '../helpers/helper';
import {encodePriceSqrt, getBalances, getPriceFromTick, snapshotGasCost} from '../helpers/utils';

const showGasUsed = false;

let Token: MockToken__factory;
let CallbackContract: MockCallbacks__factory;
let factory: Factory;
let tokenA: MockToken;
let tokenB: MockToken;
let token0: MockToken;
let token1: MockToken;
let weth: MockWeth;
let router: Router;
let callback: MockCallbacks;
let vestingPeriod = 100;
let swapFeeUnitsArray = [50, 300];
let tickDistanceArray = [10, 60];
let ticksPrevious: [BN, BN] = [MIN_TICK, MIN_TICK];
let initialPrice: BN;
let ticks: number[];

let snapshotId: any;

describe('Router', () => {
  const [user, admin] = waffle.provider.getWallets();

  before('factory, token and callback setup', async () => {
    Token = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    tokenA = await Token.deploy('USDC', 'USDC', BN.from(1000000).mul(PRECISION));
    tokenB = await Token.deploy('DAI', 'DAI', BN.from(1000000).mul(PRECISION));
    factory = await deployFactory(admin, vestingPeriod);

    const WETH = (await ethers.getContractFactory('MockWeth')) as MockWeth__factory;
    weth = await WETH.deploy();
    const Router = (await ethers.getContractFactory('Router')) as Router__factory;
    router = await Router.deploy(factory.address, weth.address);

    // use callback to add liquidity
    CallbackContract = (await ethers.getContractFactory('MockCallbacks')) as MockCallbacks__factory;

    // add any newly defined tickDistance apart from default ones
    for (let i = 0; i < swapFeeUnitsArray.length; i++) {
      if ((await factory.feeAmountTickDistance(swapFeeUnitsArray[i])) == 0) {
        await factory.connect(admin).enableSwapFee(swapFeeUnitsArray[i], tickDistanceArray[i]);
      }
    }

    initialPrice = encodePriceSqrt(1, 1);
    ticks = [-100 * tickDistanceArray[0], 100 * tickDistanceArray[0]];

    await weth.connect(user).deposit({value: PRECISION.mul(BN.from(10))});
    await weth.connect(user).approve(router.address, MAX_UINT);
    await tokenA.connect(user).approve(router.address, MAX_UINT);
    await tokenB.connect(user).approve(router.address, MAX_UINT);

    snapshotId = await snapshot();
  });

  const setupCallback = async function (tokenA: MockToken, tokenB: MockToken) {
    callback = await CallbackContract.connect(user).deploy(tokenA.address, tokenB.address);
    await tokenA.connect(user).approve(callback.address, MAX_UINT);
    await tokenB.connect(user).approve(callback.address, MAX_UINT);
  };

  const setupPool = async function (
    token0: string,
    token1: string,
    fee: number,
    sqrtP: BN,
    ticks: number[]
  ): Promise<Pool> {
    await setupCallback(Token.attach(token0), Token.attach(token1));
    await factory.createPool(token0, token1, fee);
    // whitelist callback
    await factory.connect(admin).addNFTManager(callback.address);
    let pool = (await ethers.getContractAt('Pool', await factory.getPool(token0, token1, fee))) as Pool;
    await callback.connect(user).unlockPool(pool.address, sqrtP);
    await callback
      .connect(user)
      .mint(pool.address, user.address, ticks[0], ticks[1], ticksPrevious, PRECISION.mul(BN.from(10)), '0x');
    return pool;
  };

  const swapExactInputSingleAndVerify = async function (
    tokenIn: string,
    tokenOut: string,
    fee: number,
    amount: BN,
    initialPrice: BN,
    useEth: boolean
  ): Promise<ContractTransaction> {
    let isSrcEth = tokenIn == weth.address && useEth;
    let isDestEth = tokenIn == weth.address && useEth;

    const swapParams = {
      tokenIn: tokenIn,
      tokenOut: tokenOut,
      fee: fee,
      recipient: user.address,
      deadline: MAX_UINT,
      amountIn: amount,
      minAmountOut: ZERO,
      limitSqrtP: initialPrice,
    };
    if (isDestEth) swapParams.recipient = ZERO_ADDRESS; // keep weth at router

    let multicallData = [router.interface.encodeFunctionData('swapExactInputSingle', [swapParams])];
    if (isSrcEth) multicallData.push(router.interface.encodeFunctionData('refundEth'));
    if (isDestEth) multicallData.push(router.interface.encodeFunctionData('unwrapWeth', [0, user.address]));

    let pool = await factory.getPool(tokenIn, tokenOut, fee);

    let userBefore = await getBalances(user.address, [ZERO_ADDRESS, tokenIn, tokenOut]);
    let poolBefore = await getBalances(pool, [ZERO_ADDRESS, tokenIn, tokenOut]);

    let tx = await router
      .connect(user)
      .multicall(multicallData, {value: isSrcEth ? amount : BN.from(0), gasPrice: ZERO});

    let userAfter = await getBalances(user.address, [ZERO_ADDRESS, tokenIn, tokenOut]);
    let poolAfter = await getBalances(pool, [ZERO_ADDRESS, tokenIn, tokenOut]);

    // check source
    if (isSrcEth) {
      // user: -(tokenIn + txFee) in eth, pool: +tokenIn in weth
      expect(userBefore[0].sub(userAfter[0])).to.be.eq(poolAfter[1].sub(poolBefore[1]));
    } else {
      // tokenIn: user -> pool
      expect(userBefore[1].sub(userAfter[1])).to.be.eq(poolAfter[1].sub(poolBefore[1]));
    }

    // check dest
    if (isDestEth) {
      // user: +tokenIn - gasFee, pool: -tokenIn in weth
      expect(userAfter[0].sub(userBefore[0])).to.be.eq(poolBefore[1].sub(poolAfter[1]));
    } else {
      // tokenOut: pool -> user
      expect(poolBefore[2].sub(poolAfter[2])).to.be.eq(userAfter[2].sub(userBefore[2]));
    }

    return tx;
  };

  const swapExactInputAndVerify = async function (
    tokens: string[],
    fee: number,
    amount: BN,
    useEth: boolean
  ): Promise<ContractTransaction> {
    let isSrcEth = tokens[0] == weth.address && useEth;
    let isDestEth = tokens[tokens.length - 1] == weth.address && useEth;

    const swapParams = {
      path: encodePath(tokens, new Array(tokens.length - 1).fill(fee)),
      recipient: user.address,
      deadline: BN.from(2).pow(255),
      amountIn: amount,
      minAmountOut: BN.from(0),
    };
    if (isDestEth) swapParams.recipient = ZERO_ADDRESS; // keep weth at router

    let multicallData = [router.interface.encodeFunctionData('swapExactInput', [swapParams])];
    if (isSrcEth) multicallData.push(router.interface.encodeFunctionData('refundEth'));
    if (isDestEth) multicallData.push(router.interface.encodeFunctionData('unwrapWeth', [0, user.address]));

    let tokenList = [ZERO_ADDRESS].concat(tokens);
    let userBefore = await getBalances(user.address, tokenList);
    let pools = [];
    let poolsBefore = [];
    for (let i = 0; i < tokens.length - 1; i++) {
      let pool = await factory.getPool(tokens[i], tokens[i + 1], fee);
      pools.push(pool);
      poolsBefore.push(await getBalances(pool, tokenList));
    }

    let tx = await router
      .connect(user)
      .multicall(multicallData, {value: isSrcEth ? amount : BN.from(0), gasPrice: ZERO});

    let userAfter = await getBalances(user.address, tokenList);
    let poolsAfter = [];
    for (let i = 0; i < pools.length; i++) {
      poolsAfter.push(await getBalances(pools[i], tokenList));
    }

    let poolLength = pools.length;

    if (tokens[0] != tokens[tokens.length - 1]) {
      // temp ignore case of loop swaps
      if (isSrcEth) {
        // user: - (amount + txFee) in eth, first pool: +amount in weth
        expect(userBefore[0].sub(userAfter[0])).to.be.eq(poolsAfter[0][1].sub(poolsBefore[0][1]));
      } else {
        expect(userBefore[1].sub(userAfter[1])).to.be.eq(poolsAfter[0][1].sub(poolsBefore[0][1]));
      }
    }

    for (let i = 0; i < poolLength - 1; i++) {
      // transfer tokenList[i + 2] from pools[i] to pools[i + 1] // first pools[0] is ETH
      expect(poolsBefore[i][i + 2].sub(poolsAfter[i][i + 2])).to.be.eq(
        poolsAfter[i + 1][i + 2].sub(poolsBefore[i + 1][i + 2])
      );
    }

    if (tokens[0] != tokens[tokens.length - 1]) {
      // temp ignore case of loop swaps
      let lastTokenId = tokenList.length - 1;
      if (isDestEth) {
        // user: +amountOut - txFee in eth, last pool: -amountOut
        expect(userAfter[0].sub(userBefore[0])).to.be.eq(
          poolsBefore[poolLength - 1][lastTokenId].sub(poolsAfter[poolLength - 1][lastTokenId])
        );
      } else {
        expect(userAfter[tokenList.length - 1].sub(userBefore[tokenList.length - 1])).to.be.eq(
          poolsBefore[poolLength - 1][lastTokenId].sub(poolsAfter[poolLength - 1][lastTokenId])
        );
      }
    }
    return tx;
  };

  const swapExactOutputSingleAndVerify = async function (
    tokenIn: string,
    tokenOut: string,
    fee: number,
    amount: BN,
    initialPrice: BN,
    useEth: boolean
  ): Promise<ContractTransaction> {
    let isSrcEth = tokenIn == weth.address && useEth;
    let isDestEth = tokenIn == weth.address && useEth;

    const swapParams = {
      tokenIn: tokenIn,
      tokenOut: tokenOut,
      fee: fee,
      recipient: user.address,
      deadline: MAX_UINT,
      amountOut: amount,
      maxAmountIn: PRECISION,
      limitSqrtP: initialPrice,
    };
    if (isDestEth) swapParams.recipient = ZERO_ADDRESS; // keep weth at router

    let multicallData = [router.interface.encodeFunctionData('swapExactOutputSingle', [swapParams])];
    if (isSrcEth) multicallData.push(router.interface.encodeFunctionData('refundEth'));
    if (isDestEth) multicallData.push(router.interface.encodeFunctionData('unwrapWeth', [0, user.address]));

    let pool = await factory.getPool(tokenIn, tokenOut, fee);
    let userBefore = await getBalances(user.address, [ZERO_ADDRESS, tokenIn, tokenOut]);
    let poolBefore = await getBalances(pool, [ZERO_ADDRESS, tokenIn, tokenOut]);

    let tx = await router
      .connect(user)
      .multicall(multicallData, {value: isSrcEth ? PRECISION : BN.from(0), gasPrice: ZERO});

    let userAfter = await getBalances(user.address, [ZERO_ADDRESS, tokenIn, tokenOut]);
    let poolAfter = await getBalances(pool, [ZERO_ADDRESS, tokenIn, tokenOut]);

    // check source
    if (isSrcEth) {
      // user: -(tokenIn + txFee) in eth, pool: +tokenIn in weth
      expect(userBefore[0].sub(userAfter[0])).to.be.eq(poolAfter[1].sub(poolBefore[1]));
    } else {
      // tokenIn: user -> pool
      expect(userBefore[1].sub(userAfter[1])).to.be.eq(poolAfter[1].sub(poolBefore[1]));
    }

    // check dest
    if (isDestEth) {
      // user: +tokenIn - gasFee, pool: -tokenIn in weth
      expect(userAfter[0].sub(userBefore[0])).to.be.eq(poolBefore[1].sub(poolAfter[1]));
    } else {
      // tokenOut: pool -> user
      expect(poolBefore[2].sub(poolAfter[2])).to.be.eq(userAfter[2].sub(userBefore[2]));
    }

    return tx;
  };

  const swapExactOutputAndVerify = async function (
    tokens: string[],
    fee: number,
    amount: BN,
    useEth: boolean
  ): Promise<ContractTransaction> {
    let isSrcEth = tokens[0] == weth.address && useEth;
    let isDestEth = tokens[tokens.length - 1] == weth.address && useEth;
    let encodeTokens = tokens.slice().reverse();

    const swapParams = {
      path: encodePath(encodeTokens, new Array(encodeTokens.length - 1).fill(fee)),
      recipient: user.address,
      deadline: BN.from(2).pow(255),
      amountOut: amount,
      maxAmountIn: PRECISION,
    };
    if (isDestEth) swapParams.recipient = ZERO_ADDRESS; // keep weth at router

    let multicallData = [router.interface.encodeFunctionData('swapExactOutput', [swapParams])];
    if (isSrcEth) multicallData.push(router.interface.encodeFunctionData('refundEth'));
    if (isDestEth) multicallData.push(router.interface.encodeFunctionData('unwrapWeth', [0, user.address]));

    let tokenList = [ZERO_ADDRESS].concat(tokens);
    let userBefore = await getBalances(user.address, tokenList);
    let pools = [];
    let poolsBefore = [];
    for (let i = 0; i < tokens.length - 1; i++) {
      let pool = await factory.getPool(tokens[i], tokens[i + 1], fee);
      pools.push(pool);
      poolsBefore.push(await getBalances(pool, tokenList));
    }

    let tx = await router
      .connect(user)
      .multicall(multicallData, {value: isSrcEth ? PRECISION : BN.from(0), gasPrice: ZERO});

    let userAfter = await getBalances(user.address, tokenList);
    let poolsAfter = [];
    for (let i = 0; i < pools.length; i++) {
      poolsAfter.push(await getBalances(pools[i], tokenList));
    }

    let poolLength = pools.length;

    if (tokens[0] != tokens[tokens.length - 1]) {
      // temp ignore case of loop swaps
      if (isSrcEth) {
        // user: - (amount + txFee) in eth, first pool: +amount in weth
        expect(userBefore[0].sub(userAfter[0])).to.be.eq(poolsAfter[0][1].sub(poolsBefore[0][1]));
      } else {
        expect(userBefore[1].sub(userAfter[1])).to.be.eq(poolsAfter[0][1].sub(poolsBefore[0][1]));
      }
    }

    for (let i = 0; i < poolLength - 1; i++) {
      // transfer tokenList[i + 2] from pools[i] to pools[i + 1] // first pools[0] is ETH
      expect(poolsBefore[i][i + 2].sub(poolsAfter[i][i + 2])).to.be.eq(
        poolsAfter[i + 1][i + 2].sub(poolsBefore[i + 1][i + 2])
      );
    }

    if (tokens[0] != tokens[tokens.length - 1]) {
      // temp ignore case of loop swaps
      let lastTokenId = tokenList.length - 1;
      if (isDestEth) {
        // user: +amountOut - txFee in eth, last pool: -amountOut
        expect(userAfter[0].sub(userBefore[0])).to.be.eq(
          poolsBefore[poolLength - 1][lastTokenId].sub(poolsAfter[poolLength - 1][lastTokenId])
        );
      } else {
        expect(userAfter[tokenList.length - 1].sub(userBefore[tokenList.length - 1])).to.be.eq(
          poolsBefore[poolLength - 1][lastTokenId].sub(poolsAfter[poolLength - 1][lastTokenId])
        );
      }
    }

    return tx;
  };

  describe('#swapExactInputSingle', async () => {
    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
    });

    it('swapExactIn: token - token', async () => {
      let gasUsed = BN.from(0);
      let numRuns = swapFeeUnitsArray.length;
      for (let i = 0; i < numRuns; i++) {
        let tickLower = -200 * tickDistanceArray[i];
        let tickUpper = 100 * tickDistanceArray[i];
        await setupPool(tokenA.address, tokenB.address, swapFeeUnitsArray[i], initialPrice, [tickLower, tickUpper]);
        let token0 = tokenA.address.toLowerCase() < tokenB.address.toLowerCase() ? tokenA : tokenB;
        let token1 = tokenA.address.toLowerCase() < tokenB.address.toLowerCase() ? tokenB : tokenA;
        // token0 -> token1
        let tx = await swapExactInputSingleAndVerify(
          token0.address,
          token1.address,
          swapFeeUnitsArray[i],
          PRECISION,
          await getPriceFromTick(tickLower),
          false
        );
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
        // token1 -> token0
        tx = await swapExactInputSingleAndVerify(
          token1.address,
          token0.address,
          swapFeeUnitsArray[i],
          PRECISION,
          await getPriceFromTick(tickUpper),
          false
        );
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      }
      if (showGasUsed) {
        console.log(
          `Average gas used for ${numRuns * 2} swapExactInputSingleAndVerify: ${gasUsed
            .div(BN.from(numRuns * 2))
            .toString()}`
        );
      }
    });

    it('eth -> token', async () => {
      let fee = swapFeeUnitsArray[0];
      await setupPool(weth.address, tokenB.address, fee, initialPrice, ticks);
      await swapExactInputSingleAndVerify(weth.address, tokenB.address, fee, BN.from(10000000), BN.from(0), true);
    });

    it('token -> eth', async () => {
      let fee = swapFeeUnitsArray[0];
      await setupPool(weth.address, tokenB.address, fee, initialPrice, ticks);
      await swapExactInputSingleAndVerify(tokenB.address, weth.address, fee, BN.from(10000000), BN.from(0), true);
    });

    it('test reverts', async () => {
      let fee = swapFeeUnitsArray[0];
      let amount = BN.from(1000000);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      await expect(
        router.connect(user).swapExactInputSingle({
          tokenIn: tokenA.address,
          tokenOut: tokenB.address,
          fee: fee,
          recipient: user.address,
          deadline: MAX_UINT,
          amountIn: amount,
          minAmountOut: PRECISION,
          limitSqrtP: ZERO,
        })
      ).to.be.revertedWith('Router: insufficient amountOut');
    });
  });

  describe('#swapExactOutputSingle', async () => {
    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
    });

    it('token - token', async () => {
      let gasUsed = BN.from(0);
      let numRuns = 1;
      for (let i = 0; i < numRuns; i++) {
        await setupPool(tokenA.address, tokenB.address, swapFeeUnitsArray[i], initialPrice, ticks);
        let tx = await swapExactOutputSingleAndVerify(
          tokenA.address,
          tokenB.address,
          swapFeeUnitsArray[i],
          BN.from(1000000),
          BN.from(0),
          false
        );
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
        tx = await swapExactOutputSingleAndVerify(
          tokenB.address,
          tokenA.address,
          swapFeeUnitsArray[i],
          BN.from(1000000),
          BN.from(0),
          false
        );
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      }
      if (showGasUsed) {
        console.log(
          `Average gas used for ${numRuns * 2} swapExactOutSingle: ${gasUsed.div(BN.from(numRuns * 2)).toString()}`
        );
      }
    });

    it('eth -> token', async () => {
      let fee = swapFeeUnitsArray[0];
      await setupPool(weth.address, tokenB.address, fee, initialPrice, ticks);
      // eth -> tokenB
      await swapExactOutputSingleAndVerify(weth.address, tokenB.address, fee, BN.from(10000000), BN.from(0), true);
    });

    it('token -> eth', async () => {
      let fee = swapFeeUnitsArray[0];
      await setupPool(weth.address, tokenB.address, fee, initialPrice, ticks);
      await swapExactOutputSingleAndVerify(tokenB.address, weth.address, fee, BN.from(10000000), BN.from(0), true);
    });

    it('test reverts', async () => {
      let fee = swapFeeUnitsArray[0];
      let amount = BN.from(1000000);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      await expect(
        router.connect(user).swapExactOutputSingle({
          tokenIn: tokenA.address,
          tokenOut: tokenB.address,
          fee: fee,
          recipient: user.address,
          deadline: MAX_UINT,
          amountOut: amount,
          maxAmountIn: ZERO,
          limitSqrtP: ZERO,
        })
      ).to.be.revertedWith('Router: amountIn is too high');
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
      let gasUsed = ZERO;
      let fee = swapFeeUnitsArray[0];
      let numRuns = firstTokens.length;
      for (let i = 0; i < numRuns; i++) {
        await setupPool(firstTokens[i], secondTokens[i], fee, initialPrice, ticks);
        let tx = await swapExactInputAndVerify([firstTokens[i], secondTokens[i]], fee, BN.from(10000000), false);
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
        tx = await swapExactInputAndVerify([secondTokens[i], firstTokens[i]], fee, BN.from(10000000), false);
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      }
      if (showGasUsed) {
        console.log(
          `Average gas used for ${numRuns * 2} swapExactIn: ${gasUsed.div(BN.from(numRuns * 2)).toString()}`
        );
      }
    });

    it('#gas one pool [ @skip-on-coverage ]', async () => {
      let firstTokens = [weth.address, tokenA.address];
      let secondTokens = [tokenA.address, tokenB.address];
      let fee = swapFeeUnitsArray[0];
      let numRuns = firstTokens.length;
      for (let i = 0; i < numRuns; i++) {
        await setupPool(firstTokens[i], secondTokens[i], fee, initialPrice, ticks);
        let tx = await swapExactInputAndVerify([firstTokens[i], secondTokens[i]], fee, BN.from(10000000), false);
        await snapshotGasCost(tx);
        tx = await swapExactInputAndVerify([secondTokens[i], firstTokens[i]], fee, BN.from(10000000), false);
        await snapshotGasCost(tx);
      }
    });

    it('2 pools', async () => {
      let fee = swapFeeUnitsArray[0];
      let gasUsed = ZERO;
      let amount = BN.from(1000000);
      await setupPool(weth.address, tokenA.address, fee, initialPrice, ticks);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      // swap eth -> tokenA -> tokenB
      let tx = await swapExactInputAndVerify([weth.address, tokenA.address, tokenB.address], fee, amount, false);
      gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      // swap tokenB -> tokenA -> eth
      tx = await swapExactInputAndVerify([tokenB.address, tokenA.address, weth.address], fee, amount, false);
      gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      if (showGasUsed) {
        console.log(`Average gas used for 2 swapExactIn 2 pools: ${gasUsed.div(BN.from(2)).toString()}`);
      }
    });

    it('#gas 2 pool [ @skip-on-coverage ]', async () => {
      let fee = swapFeeUnitsArray[0];
      let amount = BN.from(1000000);
      await setupPool(weth.address, tokenA.address, fee, initialPrice, ticks);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      // swap tokenB -> tokenA -> eth
      let tx = await swapExactInputAndVerify([tokenB.address, tokenA.address, weth.address], fee, amount, false);
      await snapshotGasCost(tx);
    });

    it('eth -> token', async () => {
      let fee = swapFeeUnitsArray[0];
      await setupPool(weth.address, tokenB.address, fee, initialPrice, ticks);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      // eth -> tokenB -> tokenA
      await swapExactInputAndVerify([weth.address, tokenB.address, tokenA.address], fee, BN.from(1000000), true);
    });

    it('token -> eth', async () => {
      let fee = swapFeeUnitsArray[0];
      await setupPool(weth.address, tokenB.address, fee, initialPrice, ticks);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      await swapExactInputAndVerify([tokenA.address, tokenB.address, weth.address], fee, BN.from(1000000), true);
    });

    it('test reverts', async () => {
      let fee = swapFeeUnitsArray[0];
      let amount = BN.from(1000000);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      await setupPool(tokenB.address, weth.address, fee, initialPrice, ticks);
      await expect(
        router.connect(user).swapExactInput({
          path: encodePath([tokenA.address, tokenB.address, weth.address], [fee, fee]),
          recipient: user.address,
          deadline: MAX_UINT,
          amountIn: amount,
          minAmountOut: PRECISION,
        })
      ).to.be.revertedWith('Router: insufficient amountOut');
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
      let gasUsed = ZERO;
      let fee = swapFeeUnitsArray[0];
      let numRuns = firstTokens.length;
      for (let i = 0; i < numRuns; i++) {
        await setupPool(firstTokens[i], secondTokens[i], fee, initialPrice, ticks);
        let tx = await swapExactOutputAndVerify([firstTokens[i], secondTokens[i]], fee, BN.from(10000000), false);
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
        tx = await swapExactOutputAndVerify([secondTokens[i], firstTokens[i]], fee, BN.from(10000000), false);
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      }
      if (showGasUsed) {
        console.log(
          `Average gas used for ${numRuns * 2} swapExactOut: ${gasUsed.div(BN.from(numRuns * 2)).toString()}`
        );
      }
    });

    it('#gas one pool [ @skip-on-coverage ]', async () => {
      let firstTokens = [weth.address, tokenA.address];
      let secondTokens = [tokenA.address, tokenB.address];
      let fee = swapFeeUnitsArray[0];
      let numRuns = firstTokens.length;
      for (let i = 0; i < numRuns; i++) {
        await setupPool(firstTokens[i], secondTokens[i], fee, initialPrice, ticks);
        let tx = await swapExactOutputAndVerify([firstTokens[i], secondTokens[i]], fee, BN.from(10000000), false);
        await snapshotGasCost(tx);
        tx = await swapExactOutputAndVerify([secondTokens[i], firstTokens[i]], fee, BN.from(10000000), false);
        await snapshotGasCost(tx);
      }
    });

    it('2 pools', async () => {
      let fee = swapFeeUnitsArray[0];
      let gasUsed = ZERO;
      let amount = BN.from(1000000);
      await setupPool(weth.address, tokenA.address, fee, initialPrice, ticks);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      // swap eth -> tokenA -> tokenB
      let tx = await swapExactOutputAndVerify([weth.address, tokenA.address, tokenB.address], fee, amount, false);
      gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      // swap tokenB -> tokenA -> eth
      tx = await swapExactOutputAndVerify([tokenB.address, tokenA.address, weth.address], fee, amount, false);
      gasUsed = gasUsed.add((await tx.wait()).gasUsed);
      if (showGasUsed) {
        console.log(`Average gas used for 2 swapExactIn 2 pools: ${gasUsed.div(BN.from(2)).toString()}`);
      }
    });

    it('#gas 2 pool [ @skip-on-coverage ]', async () => {
      let fee = swapFeeUnitsArray[0];
      let amount = BN.from(1000000);
      await setupPool(weth.address, tokenA.address, fee, initialPrice, ticks);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      // swap tokenB -> tokenA -> eth
      let tx = await swapExactOutputAndVerify([tokenB.address, tokenA.address, weth.address], fee, amount, false);
      await snapshotGasCost(tx);
    });

    it('eth -> token', async () => {
      let fee = swapFeeUnitsArray[0];
      await setupPool(weth.address, tokenB.address, fee, initialPrice, ticks);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      // eth -> tokenB -> tokenA
      await swapExactOutputAndVerify([weth.address, tokenB.address, tokenA.address], fee, BN.from(1000000), true);
    });

    it('token -> eth', async () => {
      let fee = swapFeeUnitsArray[0];
      await setupPool(weth.address, tokenB.address, fee, initialPrice, ticks);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      await swapExactOutputAndVerify([tokenA.address, tokenB.address, weth.address], fee, BN.from(1000000), true);
    });

    it('test reverts', async () => {
      let fee = swapFeeUnitsArray[0];
      let amount = BN.from(1000000);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      await setupPool(tokenB.address, weth.address, fee, initialPrice, ticks);
      await expect(
        router.connect(user).swapExactOutput({
          path: encodePath([tokenA.address, tokenB.address, weth.address], [fee, fee]),
          recipient: user.address,
          deadline: MAX_UINT,
          amountOut: amount,
          maxAmountIn: ZERO,
        })
      ).to.be.revertedWith('Router: amountIn is too high');
    });
  });

  describe(`#others`, async () => {
    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
    });

    it('swap a loop with 3 pools', async () => {
      let fee = swapFeeUnitsArray[0];
      let amount = BN.from(1000000);
      await setupPool(weth.address, tokenA.address, fee, initialPrice, ticks);
      await setupPool(weth.address, tokenB.address, fee, initialPrice, ticks);
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      await swapExactInputAndVerify([weth.address, tokenA.address, tokenB.address, weth.address], fee, amount, false);
      await swapExactInputAndVerify(
        [tokenA.address, weth.address, tokenB.address, tokenA.address],
        fee,
        amount,
        false
      );
      await swapExactOutputAndVerify(
        [tokenB.address, tokenA.address, weth.address, tokenB.address],
        fee,
        amount,
        false
      );
    });

    it('callback: invalid data', async () => {
      await expect(router.connect(user).swapCallback(0, 0, '0x')).to.be.revertedWith('Router: invalid delta qties');
      await expect(router.connect(user).swapCallback(-1, 0, '0x')).to.be.revertedWith('Router: invalid delta qties');
      await expect(router.connect(user).swapCallback(0, -1, '0x')).to.be.revertedWith('Router: invalid delta qties');
    });

    it('callback: invalid caller', async () => {
      let mockEncoder = (await (await ethers.getContractFactory('MockEncoder')).deploy()) as MockEncoder;
      await expect(
        router
          .connect(user)
          .swapCallback(
            PRECISION,
            PRECISION,
            await mockEncoder.encodeSwapCallbackData(tokenA.address, 1000, tokenB.address)
          )
      ).to.be.revertedWith('Router: invalid callback sender');
    });

    it('swap: expiry', async () => {
      let fee = swapFeeUnitsArray[0];
      await setupPool(tokenA.address, tokenB.address, fee, initialPrice, ticks);
      let amount = BN.from(100000);
      await expect(
        router.connect(user).swapExactInputSingle({
          tokenIn: tokenA.address,
          tokenOut: tokenB.address,
          fee: fee,
          recipient: user.address,
          deadline: ZERO,
          amountIn: amount,
          minAmountOut: ZERO,
          limitSqrtP: initialPrice,
        })
      ).to.be.revertedWith('Expired');
      await expect(
        router.connect(user).swapExactInput({
          path: encodePath([tokenA.address, tokenB.address], [fee]),
          recipient: user.address,
          deadline: ZERO,
          amountIn: amount,
          minAmountOut: ZERO,
        })
      ).to.be.revertedWith('Expired');

      await expect(
        router.connect(user).swapExactOutputSingle({
          tokenIn: tokenA.address,
          tokenOut: tokenB.address,
          fee: fee,
          recipient: user.address,
          deadline: ZERO,
          amountOut: amount,
          maxAmountIn: PRECISION,
          limitSqrtP: initialPrice,
        })
      ).to.be.revertedWith('Expired');
      await expect(
        router.connect(user).swapExactOutput({
          path: encodePath([tokenA.address, tokenB.address], [fee]),
          recipient: user.address,
          deadline: ZERO,
          amountOut: amount,
          maxAmountIn: PRECISION,
        })
      ).to.be.revertedWith('Expired');
    });
  });
});
