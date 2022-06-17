import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {ZERO, ONE, TWO_POW_96, TWO, PRECISION, NEGATIVE_ONE} from '../helpers/helper';

import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {MockQtyDeltaMath, MockQtyDeltaMath__factory} from '../../typechain';
import {encodePriceSqrt} from '../helpers/utils';

let qtyDeltaMath: MockQtyDeltaMath;

describe('QtyDeltaMath', () => {
  before('setup', async () => {
    const qtyDeltaMathFactory = (await ethers.getContractFactory('MockQtyDeltaMath')) as MockQtyDeltaMath__factory;
    qtyDeltaMath = await qtyDeltaMathFactory.deploy();
  });

  describe('#calcRequiredQty0', async () => {
    it('should revert if price is 0', async () => {
      await expect(qtyDeltaMath.calcRequiredQty0(ZERO, TWO_POW_96, ONE, true)).to.be.reverted;
      await expect(qtyDeltaMath.calcRequiredQty0(ZERO, TWO_POW_96, ONE, false)).to.be.reverted;
      await expect(qtyDeltaMath.calcRequiredQty0(TWO_POW_96, ZERO, ONE, true)).to.be.reverted;
      await expect(qtyDeltaMath.calcRequiredQty0(TWO_POW_96, ZERO, ONE, false)).to.be.reverted;
    });

    it('should return 0 if liquidity is 0', async () => {
      expect(await qtyDeltaMath.calcRequiredQty0(TWO_POW_96, TWO_POW_96.mul(TWO), ZERO, true)).to.be.eq(ZERO);
      expect(await qtyDeltaMath.calcRequiredQty0(TWO_POW_96, TWO_POW_96.mul(TWO), ZERO, false)).to.be.eq(ZERO);
    });

    it('should return 0 if prices are equal', async () => {
      expect(await qtyDeltaMath.calcRequiredQty0(TWO_POW_96, TWO_POW_96, PRECISION, true)).to.be.eq(ZERO);
      expect(await qtyDeltaMath.calcRequiredQty0(TWO_POW_96, TWO_POW_96, PRECISION, false)).to.be.eq(ZERO);
    });

    it('returns 0.1 amount1 for price of 1 to 1.21', async () => {
      const amount0Up = await qtyDeltaMath.calcRequiredQty0(
        encodePriceSqrt(1, 1),
        encodePriceSqrt(121, 100),
        PRECISION,
        true
      );
      expect(amount0Up).to.eq('90909090909090910');
      const amount0Down = await qtyDeltaMath.calcRequiredQty0(
        encodePriceSqrt(1, 1),
        encodePriceSqrt(121, 100),
        PRECISION,
        false
      );
      expect(amount0Down.mul(NEGATIVE_ONE)).to.eq(amount0Up.sub(1));
    });

    it('works for prices that overflow', async () => {
      const amount0Up = await qtyDeltaMath.calcRequiredQty0(
        encodePriceSqrt(TWO.pow(90), 1),
        encodePriceSqrt(TWO_POW_96, 1),
        PRECISION,
        true
      );
      const amount0Down = await qtyDeltaMath.calcRequiredQty0(
        encodePriceSqrt(TWO.pow(90), 1),
        encodePriceSqrt(TWO_POW_96, 1),
        PRECISION,
        false
      );
      expect(amount0Down.mul(NEGATIVE_ONE)).to.eq(amount0Up.sub(1));
    });

    // it(`gas cost for amount0 where roundUp = true`, async () => {
    //   await snapshotGasCost(
    //     sqrtPMath.getGasCostOfGetAmount0Delta(
    //       encodePriceSqrt(100, 121),
    //       encodePriceSqrt(1, 1),
    //       expandTo18Decimals(1),
    //       true
    //     )
    //   )
    // })

    // it(`gas cost for amount0 where roundUp = true`, async () => {
    //   await snapshotGasCost(
    //     sqrtPMath.getGasCostOfGetAmount0Delta(
    //       encodePriceSqrt(100, 121),
    //       encodePriceSqrt(1, 1),
    //       expandTo18Decimals(1),
    //       false
    //     )
    //   )
    // })
  });

  describe('#calcRequiredQty1', () => {
    it('returns 0 if liquidity is 0', async () => {
      expect(await qtyDeltaMath.calcRequiredQty1(ONE, TWO, ZERO, true)).to.be.eq(ZERO);
      expect(await qtyDeltaMath.calcRequiredQty1(ONE, TWO, ZERO, false)).to.be.eq(ZERO);
    });

    it('should return 0 if prices are equal', async () => {
      expect(await qtyDeltaMath.calcRequiredQty1(TWO_POW_96, TWO_POW_96, PRECISION, true)).to.be.eq(ZERO);
      expect(await qtyDeltaMath.calcRequiredQty1(TWO_POW_96, TWO_POW_96, PRECISION, false)).to.be.eq(ZERO);
    });

    it('returns 0.1 amount1 for price of 1 to 1.21', async () => {
      const amount1Up = await qtyDeltaMath.calcRequiredQty1(
        encodePriceSqrt(1, 1),
        encodePriceSqrt(121, 100),
        PRECISION,
        true
      );
      expect(amount1Up).to.eq('100000000000000000');

      const amount1Down = await qtyDeltaMath.calcRequiredQty1(
        encodePriceSqrt(1, 1),
        encodePriceSqrt(121, 100),
        PRECISION,
        false
      );
      expect(amount1Down.mul(NEGATIVE_ONE)).to.eq(amount1Up.sub(1));
    });

    // it(`gas cost for amount0 where roundUp = true`, async () => {
    //   await snapshotGasCost(
    //     sqrtPMath.getGasCostOfGetAmount0Delta(
    //       encodePriceSqrt(100, 121),
    //       encodePriceSqrt(1, 1),
    //       expandTo18Decimals(1),
    //       true
    //     )
    //   )
    // })

    // it(`gas cost for amount0 where roundUp = false`, async () => {
    //   await snapshotGasCost(
    //     sqrtPMath.getGasCostOfGetAmount0Delta(
    //       encodePriceSqrt(100, 121),
    //       encodePriceSqrt(1, 1),
    //       expandTo18Decimals(1),
    //       false
    //     )
    //   )
    // })
  });

  describe('getQty0FromBurnRTokens && getQty1FromBurnRTokens', () => {
    it('liquidity = 0', async () => {
      const result = await qtyDeltaMath.getQtyFromBurnRTokens(TWO_POW_96, ZERO);
      expect(result.qty0).to.equal(0);
      expect(result.qty1).to.equal(0);
    });

    it('price = 0 then revert', async () => {
      expect(qtyDeltaMath.getQtyFromBurnRTokens(ZERO, PRECISION)).to.be.reverted;
    });

    it('liquidity=PRECISION, sqrtP=2 => qty0=0.5*PRECISION - qty1=2*PRECISION', async () => {
      const result = await qtyDeltaMath.getQtyFromBurnRTokens(TWO_POW_96.mul(2), PRECISION);
      expect(result.qty0).to.equal(PRECISION.div(TWO));
      expect(result.qty1).to.equal(PRECISION.mul(TWO));
    });
  });
});
