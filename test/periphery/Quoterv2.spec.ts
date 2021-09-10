import {ethers, waffle} from 'hardhat';
const {solidity, loadFixture} = waffle;
import chai, {expect} from 'chai';
chai.use(solidity);
import {BigNumber as BN} from 'ethers';

import {MAX_UINT, PRECISION} from '../helpers/helper';
import {deployFactory, setupPoolWithLiquidity} from '../helpers/proAMMSetup';
import {encodePath} from '../helpers/swapPath';
import {encodePriceSqrt} from '../helpers/utils';

import {QuoterV2, QuoterV2__factory} from '../../typechain';
import {MockToken, MockToken__factory} from '../../typechain';
import {ProAMMPool, MockTickMath, MockTickMath__factory} from '../../typechain';
import {MockProAMMCallbacks2, MockProAMMCallbacks2__factory} from '../../typechain';

let swapFeeBpsArray = [5, 2];
let tickSpacingArray = [10, 6];

class Fixtures {
  constructor (
    public pool02: ProAMMPool,
    public tokens: MockToken[3],
    public callback: MockProAMMCallbacks2,
    public quoter: QuoterV2,
    public tickMath: MockTickMath
  ) {}
}

async function quoteToPrice (
  quoter: QuoterV2,
  tokenIn: MockToken,
  tokenOut: MockToken,
  targetSqrtPrice: BN,
  isInput: boolean
): Promise<BN> {
  if (isInput) {
    const {usedAmount: amountIn, afterSqrtPrice} = await quoter.callStatic.quoteExactInputSingle({
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      amountIn: PRECISION.mul(PRECISION),
      feeBps: swapFeeBpsArray[1],
      sqrtPriceLimitX96: targetSqrtPrice
    });
    // assert that we reach the targetPrice
    expect(afterSqrtPrice).to.eq(targetSqrtPrice);
    return amountIn;
  } else {
    const {usedAmount: amountOut, afterSqrtPrice} = await quoter.callStatic.quoteExactOutputSingle({
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      amount: PRECISION.mul(PRECISION),
      feeBps: swapFeeBpsArray[1],
      sqrtPriceLimitX96: targetSqrtPrice
    });
    // assert that we reach the targetPrice
    expect(afterSqrtPrice).to.eq(targetSqrtPrice);
    return amountOut;
  }
}

describe('QuoterV2', function () {
  let [admin, wallet] = waffle.provider.getWallets();

  async function fixture (): Promise<Fixtures> {
    let factory = await deployFactory(admin);
    // add any newly defined tickSpacing apart from default ones
    for (let i = 0; i < swapFeeBpsArray.length; i++) {
      if ((await factory.feeAmountTickSpacing(swapFeeBpsArray[i])) == 0) {
        await factory.connect(admin).enableSwapFee(swapFeeBpsArray[i], tickSpacingArray[i]);
      }
    }

    const TickMathContract = (await ethers.getContractFactory('MockTickMath')) as MockTickMath__factory;
    const tickMath = await TickMathContract.deploy();

    const CallbackContract = (await ethers.getContractFactory(
      'MockProAMMCallbacks2'
    )) as MockProAMMCallbacks2__factory;
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
      swapFeeBpsArray[0],
      encodePriceSqrt(100, 102)
    );
    await setupPoolWithLiquidity(
      factory,
      callback,
      wallet.address,
      tokens[1],
      tokens[2],
      swapFeeBpsArray[0],
      encodePriceSqrt(100, 200)
    );
    let [pool02] = await setupPoolWithLiquidity(
      factory,
      callback,
      wallet.address,
      tokens[0],
      tokens[2],
      swapFeeBpsArray[1],
      await tickMath.getMiddleSqrtRatioAtTick(24)
    );

    // mint serveral initialized ticks for testing [0, 24, 36, 48] - current tick = 24
    await callback.mint(pool02.address, wallet.address, 12, 36, PRECISION.div(10));
    await callback.mint(pool02.address, wallet.address, 0, 48, PRECISION.div(10));

    const QuoterV2Contract = (await ethers.getContractFactory('QuoterV2')) as QuoterV2__factory;
    let quoter = await QuoterV2Contract.deploy(factory.address);

    return new Fixtures(pool02, tokens, callback, quoter, tickMath);
  }

  let tokens: MockToken[];
  let quoter: QuoterV2;
  let callback: MockProAMMCallbacks2;
  let tickMath: MockTickMath;
  let pool02: ProAMMPool;

  // helper for getting weth and token balances
  beforeEach('load fixture', async () => {
    ({pool02, tokens, callback, quoter, tickMath} = await loadFixture(fixture));
  });

  describe('quotes', () => {
    describe('#quoteExactInput', () => {
      it('0 -> 2 cross 2 tick', async () => {
        let nextSqrtPrice = await tickMath.getMiddleSqrtRatioAtTick(-4);
        let amountIn = await quoteToPrice(quoter, tokens[0], tokens[2], nextSqrtPrice, true);
        const {amountOut, afterSqrtPriceList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactInput(
          encodePath([tokens[0].address, tokens[2].address], [swapFeeBpsArray[1]]),
          amountIn
        );
        expect(afterSqrtPriceList.length).to.eq(1);
        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(2);

        console.log(`amountOut: ${amountOut}`);
        console.log(`afterSqrtPriceList: ${afterSqrtPriceList[0]}`);
      });

      it('0 -> 2 cross 2 tick where after is initialized', async () => {
        let nextSqrtPrice = await tickMath.getMiddleSqrtRatioAtTick(0);
        let amountIn = await quoteToPrice(quoter, tokens[0], tokens[2], nextSqrtPrice, true);

        const {amountOut, afterSqrtPriceList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactInput(
          encodePath([tokens[0].address, tokens[2].address], [swapFeeBpsArray[1]]),
          amountIn
        );
        expect(afterSqrtPriceList.length).to.eq(1);
        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(1);

        console.log(`amountOut=${amountOut}`);
        console.log(`afterSqrtPriceList: ${afterSqrtPriceList[0]}`);
      });

      it('0 -> 2 cross 1 tick', async () => {
        let nextSqrtPrice = await tickMath.getMiddleSqrtRatioAtTick(11);
        let amountIn = await quoteToPrice(quoter, tokens[0], tokens[2], nextSqrtPrice, true);

        const {amountOut, afterSqrtPriceList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactInput(
          encodePath([tokens[0].address, tokens[2].address], [swapFeeBpsArray[1]]),
          amountIn
        );

        expect(afterSqrtPriceList.length).to.eq(1);
        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(1);

        console.log(`amountOut=${amountOut}`);
        console.log(`afterSqrtPriceList: ${afterSqrtPriceList[0]}`);
      });

      it('0 -> 2 cross 0 tick, starting tick not initialized', async () => {
        let nextSqrtPrice = await tickMath.getMiddleSqrtRatioAtTick(13);
        let amountIn = await quoteToPrice(quoter, tokens[0], tokens[2], nextSqrtPrice, true);

        const {amountOut, afterSqrtPriceList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactInput(
          encodePath([tokens[0].address, tokens[2].address], [swapFeeBpsArray[1]]),
          amountIn
        );

        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(0);
        expect(afterSqrtPriceList.length).to.eq(1);

        console.log(`amountOut=${amountOut}`);
        console.log(`afterSqrtPriceList: ${afterSqrtPriceList[0]}`);
      });

      it('0 -> 2 cross 0 tick, starting tick initialized', async () => {
        // Tick 24 initialized. Tick after = 25
        await callback.mint(pool02.address, wallet.address, 0, 24, PRECISION.div(10));

        let nextSqrtPrice = await tickMath.getMiddleSqrtRatioAtTick(13);
        let amountIn = await quoteToPrice(quoter, tokens[0], tokens[2], nextSqrtPrice, true);

        const {amountOut, afterSqrtPriceList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactInput(
          encodePath([tokens[0].address, tokens[2].address], [swapFeeBpsArray[1]]),
          amountIn
        );

        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(1);
        expect(afterSqrtPriceList.length).to.eq(1);

        console.log(`amountOut=${amountOut}`);
        console.log(`afterSqrtPriceList: ${afterSqrtPriceList[0]}`);
      });

      it('2 -> 0 cross 2', async () => {
        let nextSqrtPrice = await tickMath.getMiddleSqrtRatioAtTick(54);
        let amountIn = await quoteToPrice(quoter, tokens[2], tokens[0], nextSqrtPrice, true);

        const {amountOut, afterSqrtPriceList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactInput(
          encodePath([tokens[2].address, tokens[0].address], [swapFeeBpsArray[1]]),
          amountIn
        );

        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(2);
        expect(afterSqrtPriceList.length).to.eq(1);

        console.log(`amountIn=${amountIn}`);
        console.log(`amountOut=${amountOut}`);
        console.log(`afterSqrtPriceList: ${afterSqrtPriceList[0]}`);
      });

      it('2 -> 0 cross 2 where tick after is initialized', async () => {
        let nextSqrtPrice = await tickMath.getMiddleSqrtRatioAtTick(48);
        let amountIn = await quoteToPrice(quoter, tokens[2], tokens[0], nextSqrtPrice, true);
        const {amountOut, afterSqrtPriceList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactInput(
          encodePath([tokens[2].address, tokens[0].address], [swapFeeBpsArray[1]]),
          amountIn
        );
        expect(afterSqrtPriceList.length).to.eq(1);
        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(2);

        console.log(`amountIn=${amountIn}`);
        console.log(`amountOut=${amountOut}`);
        console.log(`afterSqrtPriceList=${afterSqrtPriceList}`);
      });

      it('2 -> 0 cross 0 tick, starting tick initialized', async () => {
        // Tick 24 initialized. Tick after = 25
        await callback.mint(pool02.address, wallet.address, 0, 24, PRECISION.div(10));

        let nextSqrtPrice = await tickMath.getMiddleSqrtRatioAtTick(25);
        let amountIn = await quoteToPrice(quoter, tokens[2], tokens[0], nextSqrtPrice, true);
        const {amountOut, afterSqrtPriceList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactInput(
          encodePath([tokens[2].address, tokens[0].address], [swapFeeBpsArray[1]]),
          amountIn
        );

        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(0);
        expect(afterSqrtPriceList.length).to.eq(1);

        console.log(`amountOut=${amountOut}`);
        console.log(`afterSqrtPriceList=${afterSqrtPriceList[0]}`);
      });

      it('2 -> 0 cross 0 tick, starting tick not initialized', async () => {
        // Tick 24 initialized. Tick after = 25
        let nextSqrtPrice = await tickMath.getMiddleSqrtRatioAtTick(25);
        let amountIn = await quoteToPrice(quoter, tokens[2], tokens[0], nextSqrtPrice, true);
        const {amountOut, afterSqrtPriceList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactInput(
          encodePath([tokens[2].address, tokens[0].address], [swapFeeBpsArray[1]]),
          amountIn
        );

        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(0);
        expect(afterSqrtPriceList.length).to.eq(1);

        console.log(`amountOut=${amountOut}`);
        console.log(`afterSqrtPriceList=${afterSqrtPriceList[0]}`);
      });

      it('0 -> 2 -> 1', async () => {
        let nextSqrtPrice = await tickMath.getMiddleSqrtRatioAtTick(-4);
        let amountIn = await quoteToPrice(quoter, tokens[0], tokens[2], nextSqrtPrice, true);
        const {amountOut, afterSqrtPriceList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactInput(
          encodePath(
            [tokens[0].address, tokens[2].address, tokens[1].address],
            [swapFeeBpsArray[1], swapFeeBpsArray[0]]
          ),
          amountIn
        );

        expect(afterSqrtPriceList.length).to.eq(2);
        expect(initializedTicksCrossedList.length).to.eq(2);
        expect(initializedTicksCrossedList[0]).to.eq(2);
        expect(initializedTicksCrossedList[1]).to.eq(0);

        console.log(`afterSqrtPriceList=[${afterSqrtPriceList[0]}, ${afterSqrtPriceList[1]}]`);
        console.log(`amountOut=${amountOut}`);
      });
    });

    describe('#quoteExactInputSingle', () => {
      it('0 -> 2', async () => {
        let priceLimit = await tickMath.getMiddleSqrtRatioAtTick(-1);
        const {
          usedAmount: amountIn,
          returnedAmount: amountOut,
          afterSqrtPrice,
          initializedTicksCrossed,
          gasEstimate
        } = await quoter.callStatic.quoteExactInputSingle({
          tokenIn: tokens[0].address,
          tokenOut: tokens[2].address,
          amountIn: PRECISION.mul(PRECISION),
          feeBps: swapFeeBpsArray[1],
          sqrtPriceLimitX96: priceLimit
        });

        console.log(`amountIn=${amountIn.toString()}`);
        console.log(`amountOut=${amountOut.toString()}`);
        console.log(`gasEstimate=${gasEstimate}`);

        expect(initializedTicksCrossed).to.be.eq(2);
        expect(afterSqrtPrice).to.be.eq(priceLimit);
      });

      it('2 -> 0', async () => {
        let priceLimit = await tickMath.getMiddleSqrtRatioAtTick(48);
        const {
          usedAmount: amountIn,
          returnedAmount: amountOut,
          afterSqrtPrice,
          initializedTicksCrossed,
          gasEstimate
        } = await quoter.callStatic.quoteExactInputSingle({
          tokenIn: tokens[2].address,
          tokenOut: tokens[0].address,
          amountIn: PRECISION.mul(PRECISION),
          feeBps: swapFeeBpsArray[1],
          sqrtPriceLimitX96: priceLimit
        });

        expect(initializedTicksCrossed).to.be.eq(2);
        expect(afterSqrtPrice).to.be.eq(priceLimit);

        console.log(`amountIn=${amountIn}`);
        console.log(`amountOut=${amountOut.toString()}`);
        console.log(`gasEstimate=${gasEstimate}`);
      });
    });

    describe('#quoteExactOutput', () => {
      it('0 -> 2 cross 2 tick', async () => {
        const targetSqrtPrice = await tickMath.getMiddleSqrtRatioAtTick(-1);
        const amountOut = await quoteToPrice(quoter, tokens[0], tokens[2], targetSqrtPrice, false);
        const {amountIn, afterSqrtPriceList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactOutput(
          encodePath([tokens[2].address, tokens[0].address], [swapFeeBpsArray[1]]),
          amountOut
        );

        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(2);

        expect(afterSqrtPriceList.length).to.eq(1);

        console.log(`amountIn: ${amountIn}`);
        console.log(`sqrtPrice: ${afterSqrtPriceList[0]}`);
      });

      it('0 -> 2 cross 2 where tick after is initialized', async () => {
        const targetSqrtPrice = await tickMath.getMiddleSqrtRatioAtTick(0);
        const amountOut = await quoteToPrice(quoter, tokens[0], tokens[2], targetSqrtPrice, false);

        const {amountIn, afterSqrtPriceList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactOutput(
          encodePath([tokens[2].address, tokens[0].address], [swapFeeBpsArray[1]]),
          amountOut
        );
        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(1);
        expect(afterSqrtPriceList.length).to.eq(1);

        console.log(`amountIn: ${amountIn}`);
        console.log(`sqrtPrice: ${afterSqrtPriceList[0]}`);
      });

      it('0 -> 2 cross 1 tick', async () => {
        const targetSqrtPrice = await tickMath.getMiddleSqrtRatioAtTick(6);
        const amountOut = await quoteToPrice(quoter, tokens[0], tokens[2], targetSqrtPrice, false);

        const {amountIn, afterSqrtPriceList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactOutput(
          encodePath([tokens[2].address, tokens[0].address], [swapFeeBpsArray[1]]),
          amountOut
        );
        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(1);
        expect(afterSqrtPriceList.length).to.eq(1);

        console.log(`amountIn: ${amountIn}`);
        console.log(`sqrtPrice: ${afterSqrtPriceList[0]}`);
      });

      it('0 -> 2 cross 0 tick starting tick initialized', async () => {
        // Tick 24 initialized. Tick after = 25
        await callback.mint(pool02.address, wallet.address, 0, 24, PRECISION.div(10));
        const targetSqrtPrice = await tickMath.getMiddleSqrtRatioAtTick(18);
        const amountOut = await quoteToPrice(quoter, tokens[0], tokens[2], targetSqrtPrice, false);

        const {amountIn, afterSqrtPriceList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactOutput(
          encodePath([tokens[2].address, tokens[0].address], [swapFeeBpsArray[1]]),
          amountOut
        );
        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(1);
        expect(afterSqrtPriceList.length).to.eq(1);

        console.log(`amountIn: ${amountIn}`);
        console.log(`sqrtPrice: ${afterSqrtPriceList[0]}`);
      });

      it('0 -> 2 cross 0 tick starting tick not initialized', async () => {
        const targetSqrtPrice = await tickMath.getMiddleSqrtRatioAtTick(18);
        const amountOut = await quoteToPrice(quoter, tokens[0], tokens[2], targetSqrtPrice, false);

        const {amountIn, afterSqrtPriceList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactOutput(
          encodePath([tokens[2].address, tokens[0].address], [swapFeeBpsArray[1]]),
          amountOut
        );
        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(0);
        expect(afterSqrtPriceList.length).to.eq(1);

        console.log(`amountIn: ${amountIn}`);
        console.log(`sqrtPrice: ${afterSqrtPriceList[0]}`);
      });

      it('2 -> 0 cross 2 ticks', async () => {
        const targetSqrtPrice = await tickMath.getMiddleSqrtRatioAtTick(54);
        const amountOut = await quoteToPrice(quoter, tokens[2], tokens[0], targetSqrtPrice, false);

        const {amountIn, afterSqrtPriceList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactOutput(
          encodePath([tokens[0].address, tokens[2].address], [swapFeeBpsArray[1]]),
          amountOut
        );
        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(2);
        expect(afterSqrtPriceList.length).to.eq(1);

        console.log(`amountIn: ${amountIn}`);
        console.log(`amountOut: ${amountOut}`);
        console.log(`sqrtPrice: ${afterSqrtPriceList[0]}`);
      });

      it('2 -> 0 cross 2 where tick after is initialized', async () => {
        const targetSqrtPrice = await tickMath.getMiddleSqrtRatioAtTick(48);
        const amountOut = await quoteToPrice(quoter, tokens[2], tokens[0], targetSqrtPrice, false);

        const {amountIn, afterSqrtPriceList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactOutput(
          encodePath([tokens[0].address, tokens[2].address], [swapFeeBpsArray[1]]),
          amountOut
        );
        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(2);
        expect(afterSqrtPriceList.length).to.eq(1);

        console.log(`amountIn: ${amountIn}`);
        console.log(`amountOut: ${amountOut}`);
        console.log(`sqrtPrice: ${afterSqrtPriceList[0]}`);
      });

      it('2 -> 0 cross 1 tick', async () => {
        const targetSqrtPrice = await tickMath.getMiddleSqrtRatioAtTick(42);
        const amountOut = await quoteToPrice(quoter, tokens[2], tokens[0], targetSqrtPrice, false);

        const {amountIn, afterSqrtPriceList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactOutput(
          encodePath([tokens[0].address, tokens[2].address], [swapFeeBpsArray[1]]),
          amountOut
        );
        expect(initializedTicksCrossedList.length).to.eq(1);
        expect(initializedTicksCrossedList[0]).to.eq(1);
        expect(afterSqrtPriceList.length).to.eq(1);

        console.log(`amountIn: ${amountIn}`);
        console.log(`amountOut: ${amountOut}`);
        console.log(`sqrtPrice: ${afterSqrtPriceList[0]}`);
      });

      it('1 -> 2 -> 0', async () => {
        const targetSqrtPrice = await tickMath.getMiddleSqrtRatioAtTick(54);
        const amountOut = await quoteToPrice(quoter, tokens[2], tokens[0], targetSqrtPrice, false);

        const {amountIn, afterSqrtPriceList, initializedTicksCrossedList} = await quoter.callStatic.quoteExactOutput(
          encodePath([tokens[1].address, tokens[2].address, tokens[0].address].reverse(), [
            swapFeeBpsArray[1],
            swapFeeBpsArray[0]
          ]),
          amountOut
        );

        expect(afterSqrtPriceList.length).to.eq(2);
        expect(initializedTicksCrossedList[0]).to.eq(2);
        expect(initializedTicksCrossedList[1]).to.eq(0);

        console.log(`afterSqrtPriceList=[${afterSqrtPriceList[0]}, ${afterSqrtPriceList[1]}]`);
        console.log(`amountIn=${amountIn}`);
      });
    });

    describe('#quoteExactOutputSingle', () => {
      it('0 -> 1', async () => {
        const {
          returnedAmount: amountIn,
          afterSqrtPrice,
          initializedTicksCrossed
        } = await quoter.callStatic.quoteExactOutputSingle({
          tokenIn: tokens[0].address,
          tokenOut: tokens[1].address,
          feeBps: swapFeeBpsArray[0],
          amount: PRECISION.mul(PRECISION),
          sqrtPriceLimitX96: encodePriceSqrt(100, 103)
        });

        expect(initializedTicksCrossed).to.eq(0);
        console.log(`amountIn=${amountIn}`);
        console.log(`afterSqrtPrice=${afterSqrtPrice}`);
      });

      it('1 -> 0', async () => {
        const {
          returnedAmount: amountIn,
          afterSqrtPrice,
          initializedTicksCrossed
        } = await quoter.callStatic.quoteExactOutputSingle({
          tokenIn: tokens[1].address,
          tokenOut: tokens[0].address,
          feeBps: swapFeeBpsArray[0],
          amount: PRECISION.mul(PRECISION),
          sqrtPriceLimitX96: encodePriceSqrt(100, 101)
        });

        expect(initializedTicksCrossed).to.eq(0);
        console.log(`amountIn=${amountIn}`);
        console.log(`afterSqrtPrice=${afterSqrtPrice}`);
      });
    });
  });
});
