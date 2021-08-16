import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {BN, ZERO, ONE, TWO, MAX_UINT, PRECISION, NEGATIVE_ONE} from '../helpers/helper';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {MockSwapMath__factory, MockSwapMath} from '../../typechain';
import {encodePriceSqrt, sqrtPriceToString} from '../helpers/utils';

let swapMath: MockSwapMath;

describe('SwapMath', () => {
  before('load contract', async () => {
    const factory = (await ethers.getContractFactory('MockSwapMath')) as MockSwapMath__factory;
    swapMath = await factory.deploy();
  });

  const fee = BN.from(30);

  it('from token0 -> token1 exact input', async () => {
    const liquidity = PRECISION.mul(ONE);
    const priceStart = encodePriceSqrt(1, 1);
    const priceEnd = encodePriceSqrt(100, 101);
    // calculate the amount of token0 to swap from 1 -> 1 / 1.01
    const delta = await swapMath.calcDeltaNext(liquidity, priceStart, priceEnd, fee, true, true);
    console.log(`delta: ${delta.toString()}`); // 0.004995092120267736

    const lc = await swapMath.calcFinalSwapFeeAmount(delta.sub(ONE), liquidity, priceStart, fee, true, true);
    console.log(`lc=${lc.toString()}`); // 0.000007492638180401 = 0.004995092120267736 * 0.003 / 2

    const finalPrice = await swapMath.calcFinalPrice(delta.sub(ONE), liquidity, lc, priceStart, true, true);
    console.log(`finalPrice=${finalPrice.toString()}`);
    expect(finalPrice).to.gte(priceEnd);

    const amountOut = await swapMath.calcActualDelta(liquidity, priceStart, priceEnd, lc, true, true);
    expect(amountOut).to.lt(ZERO);
    console.log(`amountOut=${amountOut.toString()}`); // -0.004955354336368578
  });

  it('from token0 -> token1 exact output', async () => {
    const liquidity = PRECISION.mul(ONE);
    const priceStart = encodePriceSqrt(1, 1);
    const priceEnd = encodePriceSqrt(100, 101);
    // calculate the amount of token0 to swap from 1 -> 1 / 1.01
    const delta = await swapMath.calcDeltaNext(liquidity, priceStart, priceEnd, fee, false, false);
    console.log(`delta: ${delta.toString()}`); // -0.004970250488226176

    const lc = await swapMath.calcFinalSwapFeeAmount(
      delta.mul(NEGATIVE_ONE).sub(ONE),
      liquidity,
      priceStart,
      fee,
      false,
      false
    );
    console.log(`lc=${lc.toString()}`); // 0.000007477809159818 = 0.004970250488226176 * 0.003 / (2 * 0.997)

    const finalPrice = await swapMath.calcFinalPrice(
      delta.mul(NEGATIVE_ONE).sub(ONE),
      liquidity,
      lc,
      priceStart,
      false,
      false
    );
    console.log(`finalPrice=${finalPrice.toString()}`);
    expect(finalPrice).to.gte(priceEnd);

    const amountOut = await swapMath.calcActualDelta(liquidity, priceStart, priceEnd, lc, false, false);
    expect(amountOut).to.gt(ZERO);
    console.log(`amountOut=${amountOut.toString()}`); // 0.004995077217286492
  });

  it('from token1 -> token0 exact input', async () => {
    const liquidity = PRECISION.mul(ONE);
    const priceStart = encodePriceSqrt(1, 1);
    const priceEnd = encodePriceSqrt(101, 100);
    // calculate the amount of token0 to swap from 1 -> 1.01
    const delta = await swapMath.calcDeltaNext(liquidity, priceStart, priceEnd, fee, true, false);
    console.log(`delta: ${delta.toString()}`); // 0.004995092120267736

    const lc = await swapMath.calcFinalSwapFeeAmount(delta.sub(ONE), liquidity, priceStart, fee, true, false);
    console.log(`lc=${lc.toString()}`); // 0.000007492638180401 = 0.004995092120267736 * 0.003 / 2

    const finalPrice = await swapMath.calcFinalPrice(delta.sub(ONE), liquidity, lc, priceStart, true, false);
    console.log(`finalPrice=${finalPrice.toString()}`);
    expect(finalPrice).to.lte(priceEnd); // 79623317895830914417022576523 >= 79623317895830914510639640423

    const amountOut = await swapMath.calcActualDelta(liquidity, priceStart, priceEnd, lc, true, false);
    expect(amountOut).to.lt(ZERO);
    console.log(`amountOut=${amountOut.toString()}`); // -0.004955354336368579
  });

  /// special case when calcDeltaNext can not get the exact amount to targetP
  it('from token1 -> token0 exact input', async () => {
    const liquidity = BN.from('6548'); // 192073834856665992950.399764417470809969
    const priceStart = BN.from('6317994584605150086931651985499439318'); // 477890273.1633855103814976986899259721398278666861
    const priceEnd = BN.from('6608956417514708620265096070220155361'); // 499965702.7726882736764249983351854726444387766131
    const fee = BN.from(3);

    console.log(`priceEnd=${sqrtPriceToString(priceStart)}`);
    console.log(`priceEnd=${sqrtPriceToString(priceEnd)}`);
    const delta = await swapMath.calcDeltaNext(liquidity, priceStart, priceEnd, fee, true, false);
    console.log(`delta: ${delta.toString()}`); // 161683723081087082937.095506066046676757

    const testAmount = delta.sub(BN.from(1));

    const lc = await swapMath.calcFinalSwapFeeAmount(testAmount, liquidity, priceStart, fee, true, false);
    console.log(`lc=${lc.toString()}`); // 16916406.564505359636169345

    const finalPrice = await swapMath.calcFinalPrice(
      testAmount,
      liquidity,
      lc.add(BN.from(1)),
      priceStart,
      true,
      false
    );
    console.log(`finalPrice=${finalPrice.toString()} : ${sqrtPriceToString(finalPrice)}`);
    expect(finalPrice).to.lte(priceEnd); // 79623317895830914417022576523 >= 79623317895830914510639640423
  });

  it('from token1 -> token0 exact output', async () => {
    const liquidity = PRECISION.mul(ONE);
    const priceStart = encodePriceSqrt(1, 1);
    const priceEnd = encodePriceSqrt(101, 100);
    // calculate the amount of token0 to swap from 1 -> 101
    const delta = await swapMath.calcDeltaNext(liquidity, priceStart, priceEnd, fee, false, true);
    console.log(`delta: ${delta.toString()}`); // -0.004970250488226176

    const lc = await swapMath.calcFinalSwapFeeAmount(
      delta.mul(NEGATIVE_ONE).sub(ONE),
      liquidity,
      priceStart,
      fee,
      false,
      true
    );
    console.log(`lc=${lc.toString()}`); // 0.000007477809159818 = 0.004970250488226176 * 0.003 / (2 * 0.997)

    const finalPrice = await swapMath.calcFinalPrice(
      delta.mul(NEGATIVE_ONE).sub(ONE),
      liquidity,
      lc,
      priceStart,
      false,
      true
    );
    console.log(`finalPrice=${finalPrice.toString()}`);
    expect(finalPrice).to.lte(priceEnd);

    const amountOut = await swapMath.calcActualDelta(liquidity, priceStart, priceEnd, lc, false, true);
    expect(amountOut).to.gt(ZERO);
    console.log(`amountOut=${amountOut.toString()}`); // 0.004995077217286491
  });
});
