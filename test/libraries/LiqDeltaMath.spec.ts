import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {ZERO, ONE, MINUS_ONE, TWO, TWO_POW_128, MAX_INT_128, MAX_UINT_128, MIN_INT_128} from '../helpers/helper';
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

  describe('#addLiquidityDelta', async () => {
    it('should return 1 for 0 + 1', async () => {
      expect(await liqDeltaMath.addLiquidityDelta(ZERO, ONE)).to.be.eql(ONE);
    });

    it('should return 0 for 1 + (-1)', async () => {
      expect(await liqDeltaMath.addLiquidityDelta(ONE, MINUS_ONE)).to.be.eql(ZERO);
    });

    it('should return same liquidity for zero liquidity delta', async () => {
      expect(await liqDeltaMath.addLiquidityDelta(ONE, ZERO)).to.be.eql(ONE);
      expect(await liqDeltaMath.addLiquidityDelta(MAX_INT_128, ZERO)).to.be.eql(MAX_INT_128);
    });

    it('should return 2 for 1 + 1', async () => {
      expect(await liqDeltaMath.addLiquidityDelta(ONE, ONE)).to.be.eql(TWO);
    });

    it('should return MAX_INT_128 for 0 + MAX_INT_128', async () => {
      expect(await liqDeltaMath.addLiquidityDelta(ZERO, MAX_INT_128)).to.be.eql(MAX_INT_128);
    });

    it('should overflow if result exceeds TWO_POW_128', async () => {
      await expect(liqDeltaMath.addLiquidityDelta(TWO_POW_128.sub(MAX_INT_128), MAX_INT_128)).to.be.reverted;
      await expect(liqDeltaMath.addLiquidityDelta(MAX_UINT_128, ONE)).to.be.reverted;
    });

    it('should overflow for max attainable values', async () => {
      await expect(liqDeltaMath.addLiquidityDelta(MAX_UINT_128, MAX_INT_128)).to.be.reverted;
    });

    // (2^127 - 1) + (-2^127)
    it('should underflow for MAX_INT_128 + (MIN_INT_128)', async () => {
      await expect(liqDeltaMath.addLiquidityDelta(MAX_INT_128, MIN_INT_128)).to.be.reverted;
    });

    it('should underflow for 0 + (-1)', async () => {
      await expect(liqDeltaMath.addLiquidityDelta(ZERO, MINUS_ONE)).to.be.reverted;
    });

    // (2^127) + (-2^127)
    it('should return 0 if liquidity = -MIN_INT_128, liquidityDelta = MIN_INT_128', async () => {
      expect(await liqDeltaMath.addLiquidityDelta(MIN_INT_128.mul(-1), MIN_INT_128)).to.be.eql(ZERO);
    });

    // (2^128 - 1) + (-2^127)
    it('should return for liquidity = MAX_UINT_128, liquidityDelta = MIN_INT_128', async () => {
      expect(await liqDeltaMath.addLiquidityDelta(MAX_UINT_128, MIN_INT_128)).to.be.eql(MAX_UINT_128.add(MIN_INT_128));
    });
  });
});
