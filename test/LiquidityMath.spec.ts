import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {BN, ZERO, ONE, TWO_POW_96, TWO, PRECISION} from './helpers/helper';

import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import { MockLiquidityMath, MockLiquidityMath__factory } from '../typechain';
import {encodePriceSqrt} from './helpers/utils';

let liquidityMath: MockLiquidityMath;

describe('LiquidityMath', () => {
  before('setup', async () => {
    const liquidityMathFactory = (await ethers.getContractFactory('MockLiquidityMath')) as MockLiquidityMath__factory;
    liquidityMath = await liquidityMathFactory.deploy();
  });

  describe('#getLiquidityFromQty0', async () => {
    it('should revert if prices are equal', async () => {
      await expect(liquidityMath.getLiquidityFromQty0(TWO_POW_96, TWO_POW_96, PRECISION)).to.be.reverted;
      await expect(liquidityMath.getLiquidityFromQty0(ONE, ONE, PRECISION)).to.be.reverted;
    });

    it('should revert if liquidity is over 2**128', async () => {
      await expect(liquidityMath.getLiquidityFromQty0(
        encodePriceSqrt(1, 1), encodePriceSqrt(121, 100), BN.from(2).pow(127)
      )).to.be.reverted;
    });

    it('should return 0 if qty is 0', async () => {
      expect(await liquidityMath.getLiquidityFromQty0(TWO_POW_96, TWO_POW_96.mul(TWO), ZERO)).to.be.eql(ZERO);
    });

    it('returns 11x liquidity for price of 1 to 1.21, qty: 10**18', async () => {
      const liquidity = await liquidityMath.getLiquidityFromQty0(encodePriceSqrt(1, 1), encodePriceSqrt(121, 100), PRECISION);
      expect(liquidity).to.eq(PRECISION.mul(11));
      expect(liquidity).to.eq(
        await liquidityMath.getLiquidityFromQty0(encodePriceSqrt(121, 100), encodePriceSqrt(1, 1), PRECISION)
      );
    });

    it('works for prices that overflow', async () => {
      liquidityMath.getLiquidityFromQty0(
        encodePriceSqrt(TWO.pow(100), 1),
        encodePriceSqrt(TWO_POW_96, 1),
        PRECISION
      );
      liquidityMath.getLiquidityFromQty0(
        encodePriceSqrt(TWO.pow(90), 1),
        encodePriceSqrt(TWO_POW_96, 1),
        PRECISION
      );
    });
  });

  describe('#getLiquidityFromQty1', async () => {
    it('should revert if prices are equal', async () => {
      await expect(liquidityMath.getLiquidityFromQty1(TWO_POW_96, TWO_POW_96, PRECISION)).to.be.reverted;
      await expect(liquidityMath.getLiquidityFromQty1(ONE, ONE, PRECISION)).to.be.reverted;
    });

    it('should revert if liquidity is over 2**128', async () => {
      await expect(liquidityMath.getLiquidityFromQty1(
        encodePriceSqrt(1, 1), encodePriceSqrt(121, 100), BN.from(2).pow(127)
      )).to.be.reverted;
    });

    it('should return 0 if qty is 0', async () => {
      expect(await liquidityMath.getLiquidityFromQty1(TWO_POW_96, TWO_POW_96.mul(TWO), ZERO)).to.be.eql(ZERO);
    });

    it('returns 10x liquidity for price of 1 to 1.21', async () => {
      const liquidity = await liquidityMath.getLiquidityFromQty1(encodePriceSqrt(1, 1), encodePriceSqrt(121, 100), PRECISION);
      expect(liquidity).to.eq(PRECISION.mul(10));
      expect(liquidity).to.eq(
        await liquidityMath.getLiquidityFromQty1(encodePriceSqrt(121, 100), encodePriceSqrt(1, 1), PRECISION)
      );
    });

    it('works for prices that overflow', async () => {
      liquidityMath.getLiquidityFromQty1(
        encodePriceSqrt(TWO.pow(100), 1),
        encodePriceSqrt(TWO_POW_96, 1),
        PRECISION
      );
      liquidityMath.getLiquidityFromQty1(
        encodePriceSqrt(TWO.pow(90), 1),
        encodePriceSqrt(TWO_POW_96, 1),
        PRECISION
      );
    });
  });

  describe('#getLiquidityFromQties', async () => {
    it('should revert if prices are equal', async () => {
      await expect(liquidityMath.getLiquidityFromQties(TWO_POW_96, TWO_POW_96, TWO_POW_96, PRECISION, PRECISION)).to.be.reverted;
      await expect(liquidityMath.getLiquidityFromQties(ONE, ONE, ONE, PRECISION, PRECISION)).to.be.reverted;
    });

    it('should revert if liquidity is over 2**128', async () => {
      await expect(liquidityMath.getLiquidityFromQties(
        encodePriceSqrt(1, 1).add(1), encodePriceSqrt(1, 1), encodePriceSqrt(121, 100), BN.from(2).pow(127), BN.from(100)
      )).to.be.reverted;
      await expect(liquidityMath.getLiquidityFromQties(
        encodePriceSqrt(1, 1).add(1), encodePriceSqrt(1, 1), encodePriceSqrt(121, 100), BN.from(100), BN.from(2).pow(127)
      )).to.be.reverted;
    });

    it('should return 0 if qty is 0', async () => {
      expect(await liquidityMath.getLiquidityFromQties(TWO_POW_96.add(ONE), TWO_POW_96, TWO_POW_96.mul(TWO), ZERO, PRECISION)).to.be.eql(ZERO);
      expect(await liquidityMath.getLiquidityFromQties(TWO_POW_96.add(ONE), TWO_POW_96, TWO_POW_96.mul(TWO), PRECISION, ZERO)).to.be.eql(ZERO);
    });

    it('returns min of liquidity for price of 1 to 1.21', async () => {
      // qty0: 11x, qty1: 10x
      const liquidity = await liquidityMath.getLiquidityFromQties(
        encodePriceSqrt(1, 1).add(1), encodePriceSqrt(1, 1), encodePriceSqrt(121, 100), PRECISION, PRECISION
      );
      expect(liquidity).to.eq(PRECISION.mul(10));
      expect(liquidity).to.eq(
        await liquidityMath.getLiquidityFromQties(encodePriceSqrt(1, 1).add(1), encodePriceSqrt(121, 100), encodePriceSqrt(1, 1), PRECISION, PRECISION)
      );
    });

    it('returns liquidity from qty0 when price is low', async () => {
      const liquidity = await liquidityMath.getLiquidityFromQties(
        encodePriceSqrt(1, 1).sub(1), encodePriceSqrt(1, 1), encodePriceSqrt(121, 100), PRECISION, PRECISION
      );
      expect(liquidity).to.eq(
        await liquidityMath.getLiquidityFromQty0(encodePriceSqrt(1, 1), encodePriceSqrt(121, 100), PRECISION)
      );
    });

    it('returns liquidity from qty1 when price is low', async () => {
      const liquidity = await liquidityMath.getLiquidityFromQties(
        encodePriceSqrt(121, 100).add(1), encodePriceSqrt(1, 1), encodePriceSqrt(121, 100), PRECISION, PRECISION
      );
      expect(liquidity).to.eq(
        await liquidityMath.getLiquidityFromQty1(encodePriceSqrt(1, 1), encodePriceSqrt(121, 100), PRECISION)
      );
    });

    it('works for prices that overflow', async () => {
      liquidityMath.getLiquidityFromQties(
        encodePriceSqrt(TWO_POW_96, 1).add(1),
        encodePriceSqrt(TWO.pow(100), 1),
        encodePriceSqrt(TWO_POW_96, 1),
        PRECISION,
        PRECISION
      );
      liquidityMath.getLiquidityFromQties(
        encodePriceSqrt(TWO_POW_96, 1).sub(1),
        encodePriceSqrt(TWO.pow(90), 1),
        encodePriceSqrt(TWO_POW_96, 1),
        PRECISION,
        PRECISION
      );
    });
  });
});
