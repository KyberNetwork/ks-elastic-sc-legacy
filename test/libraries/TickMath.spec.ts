import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {BN, ONE, TWO, MIN_SQRT_RATIO, MAX_SQRT_RATIO} from '../helpers/helper';
import {encodePriceSqrt} from '../helpers/utils';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import Decimal from 'decimal.js';
Decimal.config({toExpNeg: -500, toExpPos: 500});

import {MockTickMath, MockTickMath__factory} from '../../typechain';

const MIN_TICK = -887272;
const MAX_TICK = 887272;

let tickMath: MockTickMath;

describe('TickMath', () => {
  before('setup', async () => {
    const factory = (await ethers.getContractFactory('MockTickMath')) as MockTickMath__factory;
    tickMath = await factory.deploy();
  });

  describe('#getSqrtRatioAtTick', () => {
    it('throws for too low', async () => {
      await expect(tickMath.getSqrtRatioAtTick(MIN_TICK - 1)).to.be.revertedWith('T');
    });

    it('throws for too low', async () => {
      await expect(tickMath.getSqrtRatioAtTick(MAX_TICK + 1)).to.be.revertedWith('T');
    });

    it('min tick', async () => {
      expect(await tickMath.getSqrtRatioAtTick(MIN_TICK)).to.eq('4295128739');
    });

    it('min tick +1', async () => {
      expect(await tickMath.getSqrtRatioAtTick(MIN_TICK + 1)).to.eq('4295343490');
    });

    it('max tick - 1', async () => {
      expect(await tickMath.getSqrtRatioAtTick(MAX_TICK - 1)).to.eq(
        '1461373636630004318706518188784493106690254656249'
      );
    });

    it('min tick ratio is less than js implementation', async () => {
      expect(await tickMath.getSqrtRatioAtTick(MIN_TICK)).to.be.lt(encodePriceSqrt(ONE, TWO.pow(BN.from(127))));
    });

    it('max tick ratio is greater than js implementation', async () => {
      expect(await tickMath.getSqrtRatioAtTick(MAX_TICK)).to.be.gt(encodePriceSqrt(TWO.pow(BN.from(127)), ONE));
    });

    it('max tick', async () => {
      expect(await tickMath.getSqrtRatioAtTick(MAX_TICK)).to.eq('1461446703485210103287273052203988822378723970342');
    });
  });

  describe('#MIN_SQRT_RATIO', async () => {
    it('equals #getSqrtRatioAtTick(MIN_TICK)', async () => {
      const min = await tickMath.getSqrtRatioAtTick(MIN_TICK);
      expect(min).to.eq(await tickMath.MIN_SQRT_RATIO());
      expect(min).to.eq(MIN_SQRT_RATIO);
    });
  });

  describe('#MAX_SQRT_RATIO', async () => {
    it('equals #getSqrtRatioAtTick(MAX_TICK)', async () => {
      const max = await tickMath.getSqrtRatioAtTick(MAX_TICK);
      expect(max).to.eq(await tickMath.MAX_SQRT_RATIO());
      expect(max).to.eq(MAX_SQRT_RATIO);
    });
  });

  describe('#getTickAtSqrtRatio', () => {
    it('throws for too low', async () => {
      await expect(tickMath.getTickAtSqrtRatio(MIN_SQRT_RATIO.sub(1))).to.be.revertedWith('R');
    });

    it('throws for too high', async () => {
      await expect(tickMath.getTickAtSqrtRatio(MAX_SQRT_RATIO)).to.be.revertedWith('R');
    });

    it('ratio of min tick', async () => {
      expect(await tickMath.getTickAtSqrtRatio(MIN_SQRT_RATIO)).to.eq(MIN_TICK);
    });
    it('ratio of min tick + 1', async () => {
      expect(await tickMath.getTickAtSqrtRatio('4295343490')).to.eq(MIN_TICK + 1);
    });
    it('ratio of max tick - 1', async () => {
      expect(await tickMath.getTickAtSqrtRatio('1461373636630004318706518188784493106690254656249')).to.eq(
        MAX_TICK - 1
      );
    });
    it('ratio closest to max tick', async () => {
      expect(await tickMath.getTickAtSqrtRatio(MAX_SQRT_RATIO.sub(1))).to.eq(MAX_TICK - 1);
    });
  });

  for (const ratio of [
    MIN_SQRT_RATIO,
    encodePriceSqrt(BN.from(10).pow(12), 1),
    encodePriceSqrt(BN.from(10).pow(6), 1),
    encodePriceSqrt(1, 64),
    encodePriceSqrt(1, 8),
    encodePriceSqrt(1, 2),
    encodePriceSqrt(1, 1),
    encodePriceSqrt(2, 1),
    encodePriceSqrt(8, 1),
    encodePriceSqrt(64, 1),
    encodePriceSqrt(1, BN.from(10).pow(6)),
    encodePriceSqrt(1, BN.from(10).pow(12)),
    MAX_SQRT_RATIO.sub(1),
  ]) {
    describe(`ratio ${ratio}`, () => {
      it('is at most off by 1', async () => {
        const jsResult = new Decimal(ratio.toString()).div(new Decimal(2).pow(96)).pow(2).log(1.0001).floor();
        const result = await tickMath.getTickAtSqrtRatio(ratio);
        const absDiff = new Decimal(result.toString()).sub(jsResult).abs();
        expect(absDiff.toNumber()).to.be.lte(1);
      });

      it('ratio is between the tick and tick+1', async () => {
        const tick = await tickMath.getTickAtSqrtRatio(ratio);
        const ratioOfTick = await tickMath.getSqrtRatioAtTick(tick);
        const ratioOfTickPlusOne = await tickMath.getSqrtRatioAtTick(tick + 1);
        expect(ratio).to.be.gte(ratioOfTick);
        expect(ratio).to.be.lt(ratioOfTickPlusOne);
      });

      // TODO: review gas cost later
      //   it('result', async () => {
      //     expect(await tickMath.getTickAtSqrtRatio(ratio)).to.matchSnapshot()
      //   })
      //   it('gas', async () => {
      //     await snapshotGasCost(tickMath.getGasCostOfGetTickAtSqrtRatio(ratio))
      //   })
    });
  }
});
