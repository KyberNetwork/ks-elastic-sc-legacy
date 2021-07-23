import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {ZERO, ONE, MINUS_ONE, TWO, TWO_POW_128, MAX_INT_128, MAX_UINT_128, MIN_INT_128} from '../helpers/helper';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {MockTickBitmap, MockTickBitmap__factory} from '../../typechain';

let tickBitmap: MockTickBitmap;

describe('TickBitmap', () => {
  beforeEach('deploy TickBitmapTest', async () => {
    const factory = (await ethers.getContractFactory('MockTickBitmap')) as MockTickBitmap__factory;
    tickBitmap = await factory.deploy();
  });

  async function initTicks(ticks: number[]): Promise<void> {
    for (const tick of ticks) {
      await tickBitmap.flipTick(tick);
    }
  }

  describe('#isInitialized', () => {
    it('is false at first', async () => {
      expect(await tickBitmap.isInitialized(1)).to.eq(false);
    });
    it('is flipped by #flipTick', async () => {
      await tickBitmap.flipTick(1);
      expect(await tickBitmap.isInitialized(1)).to.eq(true);
    });
    it('is flipped back by #flipTick', async () => {
      await tickBitmap.flipTick(1);
      await tickBitmap.flipTick(1);
      expect(await tickBitmap.isInitialized(1)).to.eq(false);
    });
    it('is not changed by another flip to a different tick', async () => {
      await tickBitmap.flipTick(2);
      expect(await tickBitmap.isInitialized(1)).to.eq(false);
    });
    it('is not changed by another flip to a different tick on another word', async () => {
      await tickBitmap.flipTick(1 + 256);
      expect(await tickBitmap.isInitialized(257)).to.eq(true);
      expect(await tickBitmap.isInitialized(1)).to.eq(false);
    });
  });

  describe('#flipTick', () => {
    it('flips only the specified tick', async () => {
      await tickBitmap.flipTick(-230);
      expect(await tickBitmap.isInitialized(-230)).to.eq(true);
      expect(await tickBitmap.isInitialized(-231)).to.eq(false);
      expect(await tickBitmap.isInitialized(-229)).to.eq(false);
      expect(await tickBitmap.isInitialized(-230 + 256)).to.eq(false);
      expect(await tickBitmap.isInitialized(-230 - 256)).to.eq(false);
      await tickBitmap.flipTick(-230);
      expect(await tickBitmap.isInitialized(-230)).to.eq(false);
      expect(await tickBitmap.isInitialized(-231)).to.eq(false);
      expect(await tickBitmap.isInitialized(-229)).to.eq(false);
      expect(await tickBitmap.isInitialized(-230 + 256)).to.eq(false);
      expect(await tickBitmap.isInitialized(-230 - 256)).to.eq(false);
    });

    it('reverts only itself', async () => {
      await tickBitmap.flipTick(-230);
      await tickBitmap.flipTick(-259);
      await tickBitmap.flipTick(-229);
      await tickBitmap.flipTick(500);
      await tickBitmap.flipTick(-259);
      await tickBitmap.flipTick(-229);
      await tickBitmap.flipTick(-259);

      expect(await tickBitmap.isInitialized(-259)).to.eq(true);
      expect(await tickBitmap.isInitialized(-229)).to.eq(false);
    });

    // it('gas cost of flipping first tick in word to initialized', async () => {
    //   await snapshotGasCost(await tickBitmap.getGasCostOfFlipTick(1))
    // })
    // it('gas cost of flipping second tick in word to initialized', async () => {
    //   await tickBitmap.flipTick(0)
    //   await snapshotGasCost(await tickBitmap.getGasCostOfFlipTick(1))
    // })
    // it('gas cost of flipping a tick that results in deleting a word', async () => {
    //   await tickBitmap.flipTick(0)
    //   await snapshotGasCost(await tickBitmap.getGasCostOfFlipTick(0))
    // })
  });

  describe('#nextInitializedTickWithinOneWord', () => {
    beforeEach('set up some ticks', async () => {
      // word boundaries are at multiples of 256
      await initTicks([-200, -55, -4, 70, 78, 84, 139, 240, 535]);
    });

    describe('willFlipTick = true', async () => {
      it('returns tick to right if at initialized tick', async () => {
        const {next, initialized} = await tickBitmap.nextInitializedTickWithinOneWord(78, true);
        expect(next).to.eq(84);
        expect(initialized).to.eq(true);
      });
      it('returns tick to right if at initialized tick', async () => {
        const {next, initialized} = await tickBitmap.nextInitializedTickWithinOneWord(-55, true);
        expect(next).to.eq(-4);
        expect(initialized).to.eq(true);
      });

      it('returns the tick directly to the right', async () => {
        const {next, initialized} = await tickBitmap.nextInitializedTickWithinOneWord(77, true);
        expect(next).to.eq(78);
        expect(initialized).to.eq(true);
      });
      it('returns the tick directly to the right', async () => {
        const {next, initialized} = await tickBitmap.nextInitializedTickWithinOneWord(-56, true);
        expect(next).to.eq(-55);
        expect(initialized).to.eq(true);
      });

      it('returns the next words initialized tick if on the right boundary', async () => {
        const {next, initialized} = await tickBitmap.nextInitializedTickWithinOneWord(255, true);
        expect(next).to.eq(511);
        expect(initialized).to.eq(false);
      });
      it('returns the next words initialized tick if on the right boundary', async () => {
        const {next, initialized} = await tickBitmap.nextInitializedTickWithinOneWord(-257, true);
        expect(next).to.eq(-200);
        expect(initialized).to.eq(true);
      });

      it('returns the next initialized tick from the next word', async () => {
        await tickBitmap.flipTick(340);
        const {next, initialized} = await tickBitmap.nextInitializedTickWithinOneWord(328, true);
        expect(next).to.eq(340);
        expect(initialized).to.eq(true);
      });
      it('does not exceed boundary', async () => {
        const {next, initialized} = await tickBitmap.nextInitializedTickWithinOneWord(508, true);
        expect(next).to.eq(511);
        expect(initialized).to.eq(false);
      });
      it('skips entire word', async () => {
        const {next, initialized} = await tickBitmap.nextInitializedTickWithinOneWord(255, true);
        expect(next).to.eq(511);
        expect(initialized).to.eq(false);
      });
      it('skips half word', async () => {
        const {next, initialized} = await tickBitmap.nextInitializedTickWithinOneWord(383, true);
        expect(next).to.eq(511);
        expect(initialized).to.eq(false);
      });

      // it('gas cost on boundary', async () => {
      //   await snapshotGasCost(await tickBitmap.getGasCostOfNextInitializedTickWithinOneWord(255, false))
      // })
      // it('gas cost just below boundary', async () => {
      //   await snapshotGasCost(await tickBitmap.getGasCostOfNextInitializedTickWithinOneWord(254, false))
      // })
      // it('gas cost for entire word', async () => {
      //   await snapshotGasCost(await tickBitmap.getGasCostOfNextInitializedTickWithinOneWord(768, false))
      // })
    });

    describe('willFlipTick = false', () => {
      it('returns same tick if initialized', async () => {
        const {next, initialized} = await tickBitmap.nextInitializedTickWithinOneWord(78, false);

        expect(next).to.eq(78);
        expect(initialized).to.eq(true);
      });
      it('returns tick directly to the left of input tick if not initialized', async () => {
        const {next, initialized} = await tickBitmap.nextInitializedTickWithinOneWord(79, false);

        expect(next).to.eq(78);
        expect(initialized).to.eq(true);
      });
      it('will not exceed the word boundary', async () => {
        const {next, initialized} = await tickBitmap.nextInitializedTickWithinOneWord(258, false);

        expect(next).to.eq(256);
        expect(initialized).to.eq(false);
      });
      it('at the word boundary', async () => {
        const {next, initialized} = await tickBitmap.nextInitializedTickWithinOneWord(256, false);

        expect(next).to.eq(256);
        expect(initialized).to.eq(false);
      });
      it('word boundary less 1 (next initialized tick in next word)', async () => {
        const {next, initialized} = await tickBitmap.nextInitializedTickWithinOneWord(72, false);

        expect(next).to.eq(70);
        expect(initialized).to.eq(true);
      });
      it('word boundary', async () => {
        const {next, initialized} = await tickBitmap.nextInitializedTickWithinOneWord(-257, false);

        expect(next).to.eq(-512);
        expect(initialized).to.eq(false);
      });
      it('entire empty word', async () => {
        const {next, initialized} = await tickBitmap.nextInitializedTickWithinOneWord(1023, false);

        expect(next).to.eq(768);
        expect(initialized).to.eq(false);
      });
      it('halfway through empty word', async () => {
        const {next, initialized} = await tickBitmap.nextInitializedTickWithinOneWord(900, false);

        expect(next).to.eq(768);
        expect(initialized).to.eq(false);
      });
      it('boundary is initialized', async () => {
        await tickBitmap.flipTick(329);
        const {next, initialized} = await tickBitmap.nextInitializedTickWithinOneWord(456, false);

        expect(next).to.eq(329);
        expect(initialized).to.eq(true);
      });

      // it('gas cost on boundary', async () => {
      //   await snapshotGasCost(await tickBitmap.getGasCostOfNextInitializedTickWithinOneWord(256, true))
      // })
      // it('gas cost just below boundary', async () => {
      //   await snapshotGasCost(await tickBitmap.getGasCostOfNextInitializedTickWithinOneWord(255, true))
      // })
      // it('gas cost for entire word', async () => {
      //   await snapshotGasCost(await tickBitmap.getGasCostOfNextInitializedTickWithinOneWord(1024, true))
      // })
    });
  });
});
