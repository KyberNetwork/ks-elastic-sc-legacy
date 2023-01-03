import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {ZERO, ONE, TWO, TWO_POW_128, MAX_UINT_128} from '../helpers/helper';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {MockLiqDeltaMath, MockLiqDeltaMath__factory} from '../../typechain';

let liqDeltaMath: MockLiqDeltaMath;

describe('LiqDeltaMath', () => {
  before('setup', async () => {
    const liqDeltaMathFactory = (await ethers.getContractFactory('MockLiqDeltaMath')) as MockLiqDeltaMath__factory;
    liqDeltaMath = await liqDeltaMathFactory.deploy();
  });

  describe('#applyLiquidityDelta', async () => {
    it('should return 1 for 0 + 1', async () => {
      expect(await liqDeltaMath.applyLiquidityDelta(ZERO, ONE, true)).to.be.eq(ONE);
    });

    it('should return 0 for 1 - 1', async () => {
      expect(await liqDeltaMath.applyLiquidityDelta(ONE, ONE, false)).to.be.eq(ZERO);
    });

    it('should return same liquidity for zero liquidity delta', async () => {
      expect(await liqDeltaMath.applyLiquidityDelta(ONE, ZERO, true)).to.be.eq(ONE);
      expect(await liqDeltaMath.applyLiquidityDelta(ONE, ZERO, false)).to.be.eq(ONE);
      expect(await liqDeltaMath.applyLiquidityDelta(MAX_UINT_128, ZERO, true)).to.be.eq(MAX_UINT_128);
      expect(await liqDeltaMath.applyLiquidityDelta(MAX_UINT_128, ZERO, false)).to.be.eq(MAX_UINT_128);
    });

    it('should return 2 for 1 + 1', async () => {
      expect(await liqDeltaMath.applyLiquidityDelta(ONE, ONE, true)).to.be.eq(TWO);
    });

    it('should return MAX_UINT_128 for 0 + MAX_UINT_128', async () => {
      expect(await liqDeltaMath.applyLiquidityDelta(ZERO, MAX_UINT_128, true)).to.be.eq(MAX_UINT_128);
    });

    it('should overflow if result exceeds TWO_POW_128', async () => {
      await expect(liqDeltaMath.applyLiquidityDelta(TWO_POW_128.sub(MAX_UINT_128), MAX_UINT_128, true)).to.be.reverted;
      await expect(liqDeltaMath.applyLiquidityDelta(MAX_UINT_128, ONE, true)).to.be.reverted;
    });

    it('should overflow for max attainable values', async () => {
      await expect(liqDeltaMath.applyLiquidityDelta(MAX_UINT_128, MAX_UINT_128, true)).to.be.reverted;
    });

    it('should underflow for (MAX_UINT_128 - 1) - MAX_UINT_128', async () => {
      await expect(liqDeltaMath.applyLiquidityDelta(MAX_UINT_128.sub(ONE), MAX_UINT_128, false)).to.be.reverted;
    });

    it('should underflow for 0 - MAX_UINT_128', async () => {
      await expect(liqDeltaMath.applyLiquidityDelta(ZERO, MAX_UINT_128, false)).to.be.reverted;
    });

    it('should underflow for 0 - 1', async () => {
      await expect(liqDeltaMath.applyLiquidityDelta(ZERO, ONE, false)).to.be.reverted;
    });

    it('should underflow for 0 + (-1)', async () => {
      await expect(liqDeltaMath.applyLiquidityDelta(ZERO, ONE, false)).to.be.reverted;
    });

    // 2^128 - 1 - (2^128 - 1)
    it('should return 0 for MAX_UINT_128 - MAX_UINT_128', async () => {
      expect(await liqDeltaMath.applyLiquidityDelta(MAX_UINT_128, MAX_UINT_128, false)).to.be.eq(ZERO);
    });
  });
});
