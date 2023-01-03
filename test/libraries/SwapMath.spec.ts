import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {BN, ZERO, ONE, TWO, MAX_UINT, PRECISION, NEGATIVE_ONE} from '../helpers/helper';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {MockSwapMath__factory, MockSwapMath, SwapMathEchidnaTest, SwapMathEchidnaTest__factory} from '../../typechain';
import {encodePriceSqrt, sqrtPToString} from '../helpers/utils';

let swapMath: MockSwapMath;
let swapMathEchidna: SwapMathEchidnaTest;

describe('SwapMath', () => {
  before('load contract', async () => {
    const factory = (await ethers.getContractFactory('MockSwapMath')) as MockSwapMath__factory;
    swapMath = await factory.deploy();

    const EchidnaContract = (await ethers.getContractFactory('SwapMathEchidnaTest')) as SwapMathEchidnaTest__factory;
    swapMathEchidna = await EchidnaContract.deploy();
  });

  const fee = BN.from(300);

  it('from token0 -> token1 exact input', async () => {
    const liquidity = PRECISION.mul(ONE);
    const priceStart = encodePriceSqrt(1, 1);
    const priceEnd = encodePriceSqrt(100, 101);
    // calculate the amount of token0 to swap from 1 -> 1 / 1.01
    const usedAmount = await swapMath.calcReachAmount(liquidity, priceStart, priceEnd, fee, true, true);
    console.log(`usedAmount: ${usedAmount.toString()}`); // 0.004995092120267736

    const lc = await swapMath.estimateIncrementalLiquidity(
      usedAmount.sub(ONE),
      liquidity,
      priceStart,
      fee,
      true,
      true
    );
    console.log(`lc=${lc.toString()}`); // 0.000007492638180401 = 0.004995092120267736 * 0.003 / 2

    const finalPrice = await swapMath.calcFinalPrice(usedAmount.sub(ONE), liquidity, lc, priceStart, true, true);
    console.log(`finalPrice=${finalPrice.toString()}`);
    expect(finalPrice).to.gte(priceEnd);

    const amountOut = await swapMath.calcReturnedAmount(liquidity, priceStart, priceEnd, lc, true, true);
    expect(amountOut).to.lt(ZERO);
    console.log(`amountOut=${amountOut.toString()}`); // -0.004955354336368578

    const lc2 = await swapMath.calcIncrementalLiquidity(usedAmount, liquidity, priceStart, priceEnd, true, true);
    console.log(`lc2=${lc2.toString()}`); // 16916406.564505359636169345
  });

  it('from token0 -> token1 exact output', async () => {
    const liquidity = PRECISION.mul(ONE);
    const priceStart = encodePriceSqrt(1, 1);
    const priceEnd = encodePriceSqrt(100, 101);
    // calculate the amount of token0 to swap from 1 -> 1 / 1.01
    const usedAmount = await swapMath.calcReachAmount(liquidity, priceStart, priceEnd, fee, false, false);
    console.log(`usedAmount: ${usedAmount.toString()}`); // -0.004970250488226176

    const lc = await swapMath.estimateIncrementalLiquidity(
      usedAmount.mul(NEGATIVE_ONE).sub(ONE),
      liquidity,
      priceStart,
      fee,
      false,
      false
    );
    console.log(`lc=${lc.toString()}`); // 0.000007477809159818 = 0.004970250488226176 * 0.003 / (2 * 0.997)

    const finalPrice = await swapMath.calcFinalPrice(
      usedAmount.mul(NEGATIVE_ONE).sub(ONE),
      liquidity,
      lc,
      priceStart,
      false,
      false
    );
    console.log(`finalPrice=${finalPrice.toString()}`);
    expect(finalPrice).to.gte(priceEnd);

    const amountOut = await swapMath.calcReturnedAmount(liquidity, priceStart, priceEnd, lc, false, false);
    expect(amountOut).to.gt(ZERO);
    console.log(`amountOut=${amountOut.toString()}`); // 0.004995077217286492

    const lc2 = await swapMath.calcIncrementalLiquidity(
      usedAmount.mul(NEGATIVE_ONE),
      liquidity,
      priceStart,
      priceEnd,
      false,
      false
    );
    console.log(`lc2=${lc2.toString()}`); // 16916406.564505359636169345
  });

  it('from token1 -> token0 exact input', async () => {
    const liquidity = PRECISION.mul(ONE);
    const priceStart = encodePriceSqrt(1, 1);
    const priceEnd = encodePriceSqrt(101, 100);
    // calculate the amount of token0 to swap from 1 -> 1.01
    const usedAmount = await swapMath.calcReachAmount(liquidity, priceStart, priceEnd, fee, true, false);
    console.log(`usedAmount: ${usedAmount.toString()}`); // 0.004995092120267736

    const lc = await swapMath.estimateIncrementalLiquidity(
      usedAmount.sub(ONE),
      liquidity,
      priceStart,
      fee,
      true,
      false
    );
    console.log(`lc=${lc.toString()}`); // 0.000007492638180401 = 0.004995092120267736 * 0.003 / 2

    const finalPrice = await swapMath.calcFinalPrice(usedAmount.sub(ONE), liquidity, lc, priceStart, true, false);
    console.log(`finalPrice=${finalPrice.toString()}`);
    expect(finalPrice).to.lte(priceEnd); // 79623317895830914417022576523 >= 79623317895830914510639640423

    const amountOut = await swapMath.calcReturnedAmount(liquidity, priceStart, priceEnd, lc, true, false);
    expect(amountOut).to.lt(ZERO);
    console.log(`amountOut=${amountOut.toString()}`); // -0.004955354336368579

    const lc2 = await swapMath.calcIncrementalLiquidity(usedAmount, liquidity, priceStart, priceEnd, true, false);
    console.log(`lc2=${lc2.toString()}`); // 16916406.564505359636169345
  });

  it('from token1 -> token0 exact output', async () => {
    const liquidity = PRECISION.mul(ONE);
    const priceStart = encodePriceSqrt(1, 1);
    const priceEnd = encodePriceSqrt(101, 100);
    // calculate the amount of token0 to swap from 1 -> 101
    const usedAmount = await swapMath.calcReachAmount(liquidity, priceStart, priceEnd, fee, false, true);
    console.log(`usedAmount: ${usedAmount.toString()}`); // -0.004970250488226176

    const lc = await swapMath.estimateIncrementalLiquidity(
      usedAmount.mul(NEGATIVE_ONE).sub(ONE),
      liquidity,
      priceStart,
      fee,
      false,
      true
    );
    console.log(`lc=${lc.toString()}`); // 0.000007477809159818 = 0.004970250488226176 * 0.003 / (2 * 0.997)

    const finalPrice = await swapMath.calcFinalPrice(
      usedAmount.mul(NEGATIVE_ONE).sub(ONE),
      liquidity,
      lc,
      priceStart,
      false,
      true
    );
    console.log(`finalPrice=${finalPrice.toString()}`);
    expect(finalPrice).to.lte(priceEnd);

    const amountOut = await swapMath.calcReturnedAmount(liquidity, priceStart, priceEnd, lc, false, true);
    expect(amountOut).to.gt(ZERO);
    console.log(`amountOut=${amountOut.toString()}`); // 0.004995077217286491

    const lc2 = await swapMath.calcIncrementalLiquidity(
      usedAmount.mul(NEGATIVE_ONE),
      liquidity,
      priceStart,
      priceEnd,
      false,
      true
    );
    console.log(`lc2=${lc2.toString()}`); // 16916406.564505359636169345
  });

  describe('#gas [ @skip-on-coverage ]', async () => {
    it('from token0 -> token1 exact input', async () => {
      const liquidity = PRECISION.mul(ONE);
      const priceStart = encodePriceSqrt(1, 1);
      const priceEnd = encodePriceSqrt(100, 101);
      // calculate the amount of token0 to swap from 1 -> 1 / 1.01
      const usedAmount = await swapMath.calcReachAmount(liquidity, priceStart, priceEnd, fee, true, true);
      console.log(`usedAmount: ${usedAmount.toString()}`); // 0.004995092120267736

      const output = await swapMath.computeSwapStep(
        liquidity,
        priceStart,
        priceEnd,
        fee,
        usedAmount.sub(ONE),
        true,
        true
      );
      expect(output.gasCost.toString()).toMatchSnapshot();
    });
  });
});
