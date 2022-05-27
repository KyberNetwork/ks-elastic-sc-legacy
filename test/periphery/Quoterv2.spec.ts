import {ethers, waffle} from 'hardhat';
const {solidity, loadFixture} = waffle;
import chai, {expect} from 'chai';
chai.use(solidity);
import {BigNumber as BN} from 'ethers';

import {MAX_UINT, PRECISION, MIN_TICK, MAX_TICK} from '../helpers/helper';
import {deployFactory, setupPoolWithLiquidity} from '../helpers/setup';
import {encodePath} from '../helpers/swapPath';
import {encodePriceSqrt} from '../helpers/utils';

import {QuoterV2, QuoterV2__factory} from '../../typechain';
import {MockToken, MockToken__factory} from '../../typechain';
import {Pool, MockTickMath, MockTickMath__factory} from '../../typechain';
import {MockCallbacks2, MockCallbacks2__factory} from '../../typechain';

let swapFeeUnitsArray = [50, 20];
let tickDistanceArray = [10, 6];
let vestingPeriod = 100;
let ticksPrevious: [BN, BN] = [MIN_TICK, MIN_TICK];

class Fixtures {
  constructor(
    public pool02: Pool,
    public tokens: MockToken[3],
    public callback: MockCallbacks2,
    public quoter: QuoterV2,
    public tickMath: MockTickMath
  ) {}
}

async function quoteToPrice(
  quoter: QuoterV2,
  tokenIn: MockToken,
  tokenOut: MockToken,
  targetSqrtP: BN,
  isInput: boolean
): Promise<BN> {
  if (isInput) {
    const {usedAmount: amountIn, afterSqrtP} = await quoter.callStatic.quoteExactInputSingle({
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      amountIn: PRECISION.mul(PRECISION),
      feeBps: swapFeeUnitsArray[1],
      limitSqrtP: targetSqrtP,
    });
    // assert that we reach the targetPrice
    expect(afterSqrtP).to.eq(targetSqrtP);
    return amountIn;
  } else {
    const {usedAmount: amountOut, afterSqrtP} = await quoter.callStatic.quoteExactOutputSingle({
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      amount: PRECISION.mul(PRECISION),
      feeBps: swapFeeUnitsArray[1],
      limitSqrtP: targetSqrtP,
    });
    // assert that we reach the targetPrice
    expect(afterSqrtP).to.eq(targetSqrtP);
    return amountOut;
  }
}

describe('QuoterV2', function () {
  let [admin, wallet] = waffle.provider.getWallets();

  async function fixture(): Promise<Fixtures> {
    let factory = await deployFactory(admin, vestingPeriod);
    // add any newly defined tickDistance apart from default ones
    for (let i = 0; i < swapFeeUnitsArray.length; i++) {
      if ((await factory.feeAmountTickDistance(swapFeeUnitsArray[i])) == 0) {
        await factory.connect(admin).enableSwapFee(swapFeeUnitsArray[i], tickDistanceArray[i]);
      }
    }

    const TickMathContract = (await ethers.getContractFactory('MockTickMath')) as MockTickMath__factory;
    const tickMath = await TickMathContract.deploy();

    const CallbackContract = (await ethers.getContractFactory('MockCallbacks2')) as MockCallbacks2__factory;
    let callback = await CallbackContract.deploy();

    // whitelist callback
    await factory.connect(admin).addNFTManager(callback.address);

    // init tokens by asc order
    const MockTokenContract = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    const tokens: MockToken[] = [];
    for (let i = 0; i < 3; i++) {
      const token = await MockTokenContract.deploy('test', 't', PRECISION.mul(PRECISION));
      tokens.push(token);
      await token.approve(callback.address, MAX_UINT);
    }
    tokens.sort((a: MockToken, b: MockToken) => {
      if (a.address.toLowerCase() < b.address.toLowerCase()) {
        return -1;
      } else {
        return 1;
      }
    });

    await setupPoolWithLiquidity(
      factory,
      callback,
      wallet.address,
      tokens[0],
      tokens[1],
      swapFeeUnitsArray[0],
      encodePriceSqrt(100, 102)
    );
    await setupPoolWithLiquidity(
      factory,
      callback,
      wallet.address,
      tokens[1],
      tokens[2],
      swapFeeUnitsArray[0],
      encodePriceSqrt(100, 200)
    );
    let [pool02] = await setupPoolWithLiquidity(
      factory,
      callback,
      wallet.address,
      tokens[0],
      tokens[2],
      swapFeeUnitsArray[1],
      await tickMath.getMiddleSqrtRatioAtTick(24)
    );

    // mint serveral initialized ticks for testing [0, 12, 36, 48] - current tick = 24
    await callback.mint(pool02.address, wallet.address, 12, 36, ticksPrevious, PRECISION.div(10));
    await callback.mint(pool02.address, wallet.address, 0, 48, ticksPrevious, PRECISION.div(10));

    const QuoterV2Contract = (await ethers.getContractFactory('QuoterV2')) as QuoterV2__factory;
    let quoter = await QuoterV2Contract.deploy(factory.address);

    return new Fixtures(pool02, tokens, callback, quoter, tickMath);
  }

  let tokens: MockToken[];
  let quoter: QuoterV2;
  let callback: MockCallbacks2;
  let tickMath: MockTickMath;
  let pool02: Pool;

  // helper for getting weth and token balances
  beforeEach('load fixture', async () => {
    ({pool02, tokens, callback, quoter, tickMath} = await loadFixture(fixture));
  });

  describe('quotes', () => {
    describe('#quoteExactInput', () => {
      it('0 -> 2 cross 2 tick', async () => {
        let nextSqrtP = await tickMath.getMiddleSqrtRatioAtTick(-4);
        let amountIn = await quoteToPrice(quoter, tokens[0], tokens[2], nextSqrtP, true);
        const {amountOut, afterSqrtPList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactInput(
          encodePath([tokens[0].address, tokens[2].address], [swapFeeUnitsArray[1]]),
          amountIn
        );
        expect(afterSqrtPList.length).to.eq(1);
        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(2);

        console.log(`amountOut: ${amountOut}`);
        console.log(`afterSqrtPList: ${afterSqrtPList[0]}`);
      });

      it('0 -> 2 cross 2 tick where after is initialized', async () => {
        let nextSqrtP = await tickMath.getMiddleSqrtRatioAtTick(0);
        let amountIn = await quoteToPrice(quoter, tokens[0], tokens[2], nextSqrtP, true);

        const {amountOut, afterSqrtPList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactInput(
          encodePath([tokens[0].address, tokens[2].address], [swapFeeUnitsArray[1]]),
          amountIn
        );
        expect(afterSqrtPList.length).to.eq(1);
        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(1);

        console.log(`amountOut=${amountOut}`);
        console.log(`afterSqrtPList: ${afterSqrtPList[0]}`);
      });

      it('0 -> 2 cross 1 tick', async () => {
        let nextSqrtP = await tickMath.getMiddleSqrtRatioAtTick(11);
        let amountIn = await quoteToPrice(quoter, tokens[0], tokens[2], nextSqrtP, true);

        const {amountOut, afterSqrtPList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactInput(
          encodePath([tokens[0].address, tokens[2].address], [swapFeeUnitsArray[1]]),
          amountIn
        );

        expect(afterSqrtPList.length).to.eq(1);
        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(1);

        console.log(`amountOut=${amountOut}`);
        console.log(`afterSqrtPList: ${afterSqrtPList[0]}`);
      });

      it('0 -> 2 cross 0 tick, starting tick not initialized', async () => {
        let nextSqrtP = await tickMath.getMiddleSqrtRatioAtTick(13);
        let amountIn = await quoteToPrice(quoter, tokens[0], tokens[2], nextSqrtP, true);

        const {amountOut, afterSqrtPList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactInput(
          encodePath([tokens[0].address, tokens[2].address], [swapFeeUnitsArray[1]]),
          amountIn
        );

        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(0);
        expect(afterSqrtPList.length).to.eq(1);

        console.log(`amountOut=${amountOut}`);
        console.log(`afterSqrtPList: ${afterSqrtPList[0]}`);
      });

      it('0 -> 2 cross 0 tick, starting tick initialized', async () => {
        // Tick 24 initialized. Tick after = 25
        await callback.mint(pool02.address, wallet.address, 0, 24, ticksPrevious, PRECISION.div(10));

        let nextSqrtP = await tickMath.getMiddleSqrtRatioAtTick(13);
        let amountIn = await quoteToPrice(quoter, tokens[0], tokens[2], nextSqrtP, true);

        const {amountOut, afterSqrtPList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactInput(
          encodePath([tokens[0].address, tokens[2].address], [swapFeeUnitsArray[1]]),
          amountIn
        );

        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(1);
        expect(afterSqrtPList.length).to.eq(1);

        console.log(`amountOut=${amountOut}`);
        console.log(`afterSqrtPList: ${afterSqrtPList[0]}`);
      });

      it('2 -> 0 cross 2', async () => {
        let nextSqrtP = await tickMath.getMiddleSqrtRatioAtTick(54);
        let amountIn = await quoteToPrice(quoter, tokens[2], tokens[0], nextSqrtP, true);

        const {amountOut, afterSqrtPList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactInput(
          encodePath([tokens[2].address, tokens[0].address], [swapFeeUnitsArray[1]]),
          amountIn
        );

        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(2);
        expect(afterSqrtPList.length).to.eq(1);

        console.log(`amountIn=${amountIn}`);
        console.log(`amountOut=${amountOut}`);
        console.log(`afterSqrtPList: ${afterSqrtPList[0]}`);
      });

      it('2 -> 0 cross 2 where tick after is initialized', async () => {
        let nextSqrtP = await tickMath.getMiddleSqrtRatioAtTick(48);
        let amountIn = await quoteToPrice(quoter, tokens[2], tokens[0], nextSqrtP, true);
        const {amountOut, afterSqrtPList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactInput(
          encodePath([tokens[2].address, tokens[0].address], [swapFeeUnitsArray[1]]),
          amountIn
        );
        expect(afterSqrtPList.length).to.eq(1);
        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(2);

        console.log(`amountIn=${amountIn}`);
        console.log(`amountOut=${amountOut}`);
        console.log(`afterSqrtPList=${afterSqrtPList}`);
      });

      it('2 -> 0 cross 0 tick, starting tick initialized', async () => {
        // Tick 24 initialized. Tick after = 25
        await callback.mint(pool02.address, wallet.address, 0, 24, ticksPrevious, PRECISION.div(10));

        let nextSqrtP = await tickMath.getMiddleSqrtRatioAtTick(25);
        let amountIn = await quoteToPrice(quoter, tokens[2], tokens[0], nextSqrtP, true);
        const {amountOut, afterSqrtPList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactInput(
          encodePath([tokens[2].address, tokens[0].address], [swapFeeUnitsArray[1]]),
          amountIn
        );

        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(0);
        expect(afterSqrtPList.length).to.eq(1);

        console.log(`amountOut=${amountOut}`);
        console.log(`afterSqrtPList=${afterSqrtPList[0]}`);
      });

      it('2 -> 0 cross 0 tick, starting tick not initialized', async () => {
        // Tick 24 initialized. Tick after = 25
        let nextSqrtP = await tickMath.getMiddleSqrtRatioAtTick(25);
        let amountIn = await quoteToPrice(quoter, tokens[2], tokens[0], nextSqrtP, true);
        const {amountOut, afterSqrtPList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactInput(
          encodePath([tokens[2].address, tokens[0].address], [swapFeeUnitsArray[1]]),
          amountIn
        );

        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(0);
        expect(afterSqrtPList.length).to.eq(1);

        console.log(`amountOut=${amountOut}`);
        console.log(`afterSqrtPList=${afterSqrtPList[0]}`);
      });

      it('0 -> 2 -> 1', async () => {
        let nextSqrtP = await tickMath.getMiddleSqrtRatioAtTick(-4);
        let amountIn = await quoteToPrice(quoter, tokens[0], tokens[2], nextSqrtP, true);
        const {amountOut, afterSqrtPList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactInput(
          encodePath(
            [tokens[0].address, tokens[2].address, tokens[1].address],
            [swapFeeUnitsArray[1], swapFeeUnitsArray[0]]
          ),
          amountIn
        );

        expect(afterSqrtPList.length).to.eq(2);
        expect(initializedTicksCrossedList.length).to.eq(2);
        expect(initializedTicksCrossedList[0]).to.eq(2);
        expect(initializedTicksCrossedList[1]).to.eq(0);

        console.log(`afterSqrtPList=[${afterSqrtPList[0]}, ${afterSqrtPList[1]}]`);
        console.log(`amountOut=${amountOut}`);
      });
    });

    describe('#quoteExactInputSingle', () => {
      it('0 -> 2', async () => {
        let priceLimit = await tickMath.getMiddleSqrtRatioAtTick(-1);
        const {
          usedAmount: amountIn,
          returnedAmount: amountOut,
          afterSqrtP,
          initializedTicksCrossed,
          gasEstimate,
        } = await quoter.callStatic.quoteExactInputSingle({
          tokenIn: tokens[0].address,
          tokenOut: tokens[2].address,
          amountIn: PRECISION.mul(PRECISION),
          feeBps: swapFeeUnitsArray[1],
          limitSqrtP: priceLimit,
        });

        console.log(`amountIn=${amountIn.toString()}`);
        console.log(`amountOut=${amountOut.toString()}`);
        console.log(`gasEstimate=${gasEstimate}`);

        expect(initializedTicksCrossed).to.be.eq(2);
        expect(afterSqrtP).to.be.eq(priceLimit);
      });

      it('2 -> 0', async () => {
        let priceLimit = await tickMath.getMiddleSqrtRatioAtTick(48);
        const {
          usedAmount: amountIn,
          returnedAmount: amountOut,
          afterSqrtP,
          initializedTicksCrossed,
          gasEstimate,
        } = await quoter.callStatic.quoteExactInputSingle({
          tokenIn: tokens[2].address,
          tokenOut: tokens[0].address,
          amountIn: PRECISION.mul(PRECISION),
          feeBps: swapFeeUnitsArray[1],
          limitSqrtP: priceLimit,
        });

        expect(initializedTicksCrossed).to.be.eq(2);
        expect(afterSqrtP).to.be.eq(priceLimit);

        console.log(`amountIn=${amountIn}`);
        console.log(`amountOut=${amountOut.toString()}`);
        console.log(`gasEstimate=${gasEstimate}`);
      });
    });

    describe('#quoteExactOutput', () => {
      it('0 -> 2 cross 2 tick', async () => {
        const targetSqrtP = await tickMath.getMiddleSqrtRatioAtTick(-1);
        const amountOut = await quoteToPrice(quoter, tokens[0], tokens[2], targetSqrtP, false);
        const {amountIn, afterSqrtPList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactOutput(
          encodePath([tokens[2].address, tokens[0].address], [swapFeeUnitsArray[1]]),
          amountOut
        );

        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(2);

        expect(afterSqrtPList.length).to.eq(1);

        console.log(`amountIn: ${amountIn}`);
        console.log(`sqrtP: ${afterSqrtPList[0]}`);
      });

      it('0 -> 2 cross 2 where tick after is initialized', async () => {
        const targetSqrtP = await tickMath.getMiddleSqrtRatioAtTick(0);
        const amountOut = await quoteToPrice(quoter, tokens[0], tokens[2], targetSqrtP, false);

        const {amountIn, afterSqrtPList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactOutput(
          encodePath([tokens[2].address, tokens[0].address], [swapFeeUnitsArray[1]]),
          amountOut
        );
        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(1);
        expect(afterSqrtPList.length).to.eq(1);

        console.log(`amountIn: ${amountIn}`);
        console.log(`sqrtP: ${afterSqrtPList[0]}`);
      });

      it('0 -> 2 cross 1 tick', async () => {
        const targetSqrtP = await tickMath.getMiddleSqrtRatioAtTick(6);
        const amountOut = await quoteToPrice(quoter, tokens[0], tokens[2], targetSqrtP, false);

        const {amountIn, afterSqrtPList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactOutput(
          encodePath([tokens[2].address, tokens[0].address], [swapFeeUnitsArray[1]]),
          amountOut
        );
        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(1);
        expect(afterSqrtPList.length).to.eq(1);

        console.log(`amountIn: ${amountIn}`);
        console.log(`sqrtP: ${afterSqrtPList[0]}`);
      });

      it('0 -> 2 cross 0 tick starting tick initialized', async () => {
        // Tick 24 initialized. Tick after = 25
        await callback.mint(pool02.address, wallet.address, 0, 24, ticksPrevious, PRECISION.div(10));
        const targetSqrtP = await tickMath.getMiddleSqrtRatioAtTick(18);
        const amountOut = await quoteToPrice(quoter, tokens[0], tokens[2], targetSqrtP, false);

        const {amountIn, afterSqrtPList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactOutput(
          encodePath([tokens[2].address, tokens[0].address], [swapFeeUnitsArray[1]]),
          amountOut
        );
        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(1);
        expect(afterSqrtPList.length).to.eq(1);

        console.log(`amountIn: ${amountIn}`);
        console.log(`sqrtP: ${afterSqrtPList[0]}`);
      });

      it('0 -> 2 cross 0 tick starting tick not initialized', async () => {
        const targetSqrtP = await tickMath.getMiddleSqrtRatioAtTick(18);
        const amountOut = await quoteToPrice(quoter, tokens[0], tokens[2], targetSqrtP, false);

        const {amountIn, afterSqrtPList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactOutput(
          encodePath([tokens[2].address, tokens[0].address], [swapFeeUnitsArray[1]]),
          amountOut
        );
        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(0);
        expect(afterSqrtPList.length).to.eq(1);

        console.log(`amountIn: ${amountIn}`);
        console.log(`sqrtP: ${afterSqrtPList[0]}`);
      });

      it('2 -> 0 cross 2 ticks', async () => {
        const targetSqrtP = await tickMath.getMiddleSqrtRatioAtTick(54);
        const amountOut = await quoteToPrice(quoter, tokens[2], tokens[0], targetSqrtP, false);

        const {amountIn, afterSqrtPList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactOutput(
          encodePath([tokens[0].address, tokens[2].address], [swapFeeUnitsArray[1]]),
          amountOut
        );
        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(2);
        expect(afterSqrtPList.length).to.eq(1);

        console.log(`amountIn: ${amountIn}`);
        console.log(`amountOut: ${amountOut}`);
        console.log(`sqrtP: ${afterSqrtPList[0]}`);
      });

      it('2 -> 0 cross 2 where tick after is initialized', async () => {
        const targetSqrtP = await tickMath.getMiddleSqrtRatioAtTick(48);
        const amountOut = await quoteToPrice(quoter, tokens[2], tokens[0], targetSqrtP, false);

        const {amountIn, afterSqrtPList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactOutput(
          encodePath([tokens[0].address, tokens[2].address], [swapFeeUnitsArray[1]]),
          amountOut
        );
        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(2);
        expect(afterSqrtPList.length).to.eq(1);

        console.log(`amountIn: ${amountIn}`);
        console.log(`amountOut: ${amountOut}`);
        console.log(`sqrtP: ${afterSqrtPList[0]}`);
      });

      it('2 -> 0 cross 1 tick', async () => {
        const targetSqrtP = await tickMath.getMiddleSqrtRatioAtTick(42);
        const amountOut = await quoteToPrice(quoter, tokens[2], tokens[0], targetSqrtP, false);

        const {amountIn, afterSqrtPList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactOutput(
          encodePath([tokens[0].address, tokens[2].address], [swapFeeUnitsArray[1]]),
          amountOut
        );
        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(1);
        expect(afterSqrtPList.length).to.eq(1);

        console.log(`amountIn: ${amountIn}`);
        console.log(`amountOut: ${amountOut}`);
        console.log(`sqrtP: ${afterSqrtPList[0]}`);
      });

      it('1 -> 2 -> 0', async () => {
        const targetSqrtP = await tickMath.getMiddleSqrtRatioAtTick(54);
        const amountOut = await quoteToPrice(quoter, tokens[2], tokens[0], targetSqrtP, false);

        const {amountIn, afterSqrtPList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactOutput(
          encodePath([tokens[1].address, tokens[2].address, tokens[0].address].reverse(), [
            swapFeeUnitsArray[1],
            swapFeeUnitsArray[0],
          ]),
          amountOut
        );

        expect(afterSqrtPList.length).to.eq(2);
        expect(initializedTicksCrossedList[0]).to.eq(2);
        expect(initializedTicksCrossedList[1]).to.eq(0);

        console.log(`afterSqrtPList=[${afterSqrtPList[0]}, ${afterSqrtPList[1]}]`);
        console.log(`amountIn=${amountIn}`);
      });
    });

    describe('#quoteExactOutputSingle', () => {
      it('0 -> 1', async () => {
        const {
          returnedAmount: amountIn,
          afterSqrtP,
          initializedTicksCrossed,
        } = await quoter.callStatic.quoteExactOutputSingle({
          tokenIn: tokens[0].address,
          tokenOut: tokens[1].address,
          feeBps: swapFeeUnitsArray[0],
          amount: PRECISION.mul(PRECISION),
          limitSqrtP: encodePriceSqrt(100, 103),
        });

        expect(initializedTicksCrossed).to.eq(0);
        console.log(`amountIn=${amountIn}`);
        console.log(`afterSqrtP=${afterSqrtP}`);
      });

      it('1 -> 0', async () => {
        const {
          returnedAmount: amountIn,
          afterSqrtP,
          initializedTicksCrossed,
        } = await quoter.callStatic.quoteExactOutputSingle({
          tokenIn: tokens[1].address,
          tokenOut: tokens[0].address,
          feeBps: swapFeeUnitsArray[0],
          amount: PRECISION.mul(PRECISION),
          limitSqrtP: encodePriceSqrt(100, 101),
        });

        expect(initializedTicksCrossed).to.eq(0);
        console.log(`amountIn=${amountIn}`);
        console.log(`afterSqrtP=${afterSqrtP}`);
      });
    });
  });
});
