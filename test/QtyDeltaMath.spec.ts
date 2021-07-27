import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {ZERO, ONE, TWO_POW_96, TWO, PRECISION, NEGATIVE_ONE} from './helpers/helper';

import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {MockQtyDeltaMath, MockQtyDeltaMath__factory} from '../typechain';
import {encodePriceSqrt} from './helpers/utils';

let qtyDeltaMath: MockQtyDeltaMath;

describe('QtyDeltaMath', () => {
  before('setup', async () => {
    const qtyDeltaMathFactory = (await ethers.getContractFactory('MockQtyDeltaMath')) as MockQtyDeltaMath__factory;
    qtyDeltaMath = await qtyDeltaMathFactory.deploy();
  });

  describe('#getQty0Delta', async () => {
    it('should revert if price is 0', async () => {
      await expect(qtyDeltaMath.getQty0Delta(ZERO, TWO_POW_96, ONE)).to.be.reverted;
      await expect(qtyDeltaMath.getQty0Delta(TWO_POW_96, ZERO, ONE)).to.be.reverted;
    });

    it('should return 0 if liquidity is 0', async () => {
      expect(await qtyDeltaMath.getQty0Delta(TWO_POW_96, TWO_POW_96.mul(TWO), ZERO)).to.be.eql(ZERO);
    });

    it('should return 0 if prices are equal', async () => {
      expect(await qtyDeltaMath.getQty0Delta(TWO_POW_96, TWO_POW_96, PRECISION)).to.be.eql(ZERO);
    });

    it('returns 0.1 amount1 for price of 1 to 1.21', async () => {
      const amount0Up = await qtyDeltaMath.getQty0Delta(encodePriceSqrt(1, 1), encodePriceSqrt(121, 100), PRECISION);
      expect(amount0Up).to.eq('90909090909090910');
      expect(amount0Up).to.eq(
        await qtyDeltaMath.getQty0Delta(encodePriceSqrt(121, 100), encodePriceSqrt(1, 1), PRECISION)
      );
      const amount0Down = await qtyDeltaMath.getQty0Delta(
        encodePriceSqrt(1, 1),
        encodePriceSqrt(121, 100),
        PRECISION.mul(NEGATIVE_ONE)
      );
      expect(amount0Down.mul(NEGATIVE_ONE)).to.eq(amount0Up.sub(1));
    });

    it('works for prices that overflow', async () => {
      const amount0Up = await qtyDeltaMath.getQty0Delta(
        encodePriceSqrt(TWO.pow(90), 1),
        encodePriceSqrt(TWO_POW_96, 1),
        PRECISION
      );
      const amount0Down = await qtyDeltaMath.getQty0Delta(
        encodePriceSqrt(TWO.pow(90), 1),
        encodePriceSqrt(TWO_POW_96, 1),
        PRECISION.mul(NEGATIVE_ONE)
      );
      expect(amount0Down.mul(NEGATIVE_ONE)).to.eq(amount0Up.sub(1));
    });

    // it(`gas cost for amount0 where roundUp = true`, async () => {
    //   await snapshotGasCost(
    //     sqrtPriceMath.getGasCostOfGetAmount0Delta(
    //       encodePriceSqrt(100, 121),
    //       encodePriceSqrt(1, 1),
    //       expandTo18Decimals(1),
    //       true
    //     )
    //   )
    // })

    // it(`gas cost for amount0 where roundUp = true`, async () => {
    //   await snapshotGasCost(
    //     sqrtPriceMath.getGasCostOfGetAmount0Delta(
    //       encodePriceSqrt(100, 121),
    //       encodePriceSqrt(1, 1),
    //       expandTo18Decimals(1),
    //       false
    //     )
    //   )
    // })
  });

  describe('#getAmount1Delta', () => {
    it('returns 0 if liquidity is 0', async () => {
      const amount1 = await qtyDeltaMath.getQty1Delta(ONE, TWO, 0);
      expect(amount1).to.eq(0);
    });

    it('returns 0 if prices are equal', async () => {
      const amount1 = await qtyDeltaMath.getQty1Delta(ONE, ONE, 0);
      expect(amount1).to.eq(0);
    });

    it('returns 0.1 amount1 for price of 1 to 1.21', async () => {
      const amount1Up = await qtyDeltaMath.getQty1Delta(encodePriceSqrt(1, 1), encodePriceSqrt(121, 100), PRECISION);
      expect(amount1Up).to.eq('100000000000000000');
      expect(amount1Up).to.eq(
        await qtyDeltaMath.getQty1Delta(encodePriceSqrt(121, 100), encodePriceSqrt(1, 1), PRECISION)
      );

      const amount1Down = await qtyDeltaMath.getQty1Delta(
        encodePriceSqrt(1, 1),
        encodePriceSqrt(121, 100),
        PRECISION.mul(NEGATIVE_ONE)
      );
      expect(amount1Down.mul(NEGATIVE_ONE)).to.eq(amount1Up.sub(1));
    });

    // it(`gas cost for amount0 where roundUp = true`, async () => {
    //   await snapshotGasCost(
    //     sqrtPriceMath.getGasCostOfGetAmount0Delta(
    //       encodePriceSqrt(100, 121),
    //       encodePriceSqrt(1, 1),
    //       expandTo18Decimals(1),
    //       true
    //     )
    //   )
    // })

    // it(`gas cost for amount0 where roundUp = false`, async () => {
    //   await snapshotGasCost(
    //     sqrtPriceMath.getGasCostOfGetAmount0Delta(
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

    it('liquidity=PRECISION, sqrtPrice=2 => qty0=0.5*PRECISION - qty1=2*PRECISION', async () => {
      const result = await qtyDeltaMath.getQtyFromBurnRTokens(TWO_POW_96.mul(2), PRECISION);
      expect(result.qty0).to.equal(PRECISION.div(TWO));
      expect(result.qty1).to.equal(PRECISION.mul(TWO));
    });
  });
});
