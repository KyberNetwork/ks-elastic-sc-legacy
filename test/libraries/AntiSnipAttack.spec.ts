import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {ZERO, ONE, TWO, FEE_UNITS, PRECISION, BN} from '../helpers/helper';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {MockAntiSnipAttack, MockAntiSnipAttack__factory} from '../../typechain';
import {getLatestBlockTime} from '../helpers/hardhat';
import {genRandomBN} from '../helpers/genRandomBN';

let antiSnipAttack: MockAntiSnipAttack;
let vestingPeriod: number;
let currentTime: number;
let currentLiquidity = PRECISION;
let liquidityDelta = PRECISION;
let feesSinceLastAction = FEE_UNITS;

describe('AntiSnipAttack', () => {
  before('setup', async () => {
    const antiSnipAttackFactory = (await ethers.getContractFactory(
      'MockAntiSnipAttack'
    )) as MockAntiSnipAttack__factory;
    antiSnipAttack = await antiSnipAttackFactory.deploy();
    currentTime = await getLatestBlockTime();
  });

  describe('#initialize', async () => {
    it('should be able to initialize data to default values', async () => {
      let data = await antiSnipAttack.data();
      expect(data.lastActionTime).to.be.eq(0);
      expect(data.lockTime).to.be.eq(0);
      expect(data.unlockTime).to.be.eq(0);
      expect(data.feesLocked).to.be.eq(ZERO);
      await antiSnipAttack.initialize(currentTime);
      data = await antiSnipAttack.data();
      expect(data.lastActionTime).to.be.eq(currentTime);
      expect(data.lockTime).to.be.eq(currentTime);
      expect(data.unlockTime).to.be.eq(currentTime);
      expect(data.feesLocked).to.be.eq(ZERO);
    });

    it('should initialize to new updated timestamp', async () => {
      await antiSnipAttack.initialize(currentTime);
      incrementTime(30);
      // re-initialize with new timestamp
      await antiSnipAttack.initialize(currentTime);
      let data = await antiSnipAttack.data();
      expect(data.lastActionTime).to.be.eq(currentTime);
      expect(data.lockTime).to.be.eq(currentTime);
      expect(data.unlockTime).to.be.eq(currentTime);
      expect(data.feesLocked).to.be.eq(ZERO);
    });
  });

  describe('#calcFeeProportions', async () => {
    it('should return 0 for 0 fees', async () => {
      let result = await antiSnipAttack.calcFeeProportions(ZERO, ZERO, ZERO, ZERO);
      expect(result.feesLockedNew).to.be.eq(ZERO);
      expect(result.feesClaimable).to.be.eq(ZERO);

      result = await antiSnipAttack.calcFeeProportions(ZERO, ZERO, FEE_UNITS, FEE_UNITS);
      expect(result.feesLockedNew).to.be.eq(ZERO);
      expect(result.feesClaimable).to.be.eq(ZERO);

      result = await antiSnipAttack.calcFeeProportions(ZERO, ZERO, ZERO, FEE_UNITS);
      expect(result.feesLockedNew).to.be.eq(ZERO);
      expect(result.feesClaimable).to.be.eq(ZERO);

      result = await antiSnipAttack.calcFeeProportions(ZERO, ZERO, FEE_UNITS, ZERO);
      expect(result.feesLockedNew).to.be.eq(ZERO);
      expect(result.feesClaimable).to.be.eq(ZERO);

      result = await antiSnipAttack.calcFeeProportions(ZERO, ZERO, ZERO, ONE);
      expect(result.feesLockedNew).to.be.eq(ZERO);
      expect(result.feesClaimable).to.be.eq(ZERO);

      result = await antiSnipAttack.calcFeeProportions(ZERO, ZERO, ONE, ZERO);
      expect(result.feesLockedNew).to.be.eq(ZERO);
      expect(result.feesClaimable).to.be.eq(ZERO);
    });

    it('should return 0 feesClaimable for 0 feesClaimableSinceLastActionBps and feesLockedCurrent', async () => {
      let result = await antiSnipAttack.calcFeeProportions(ZERO, PRECISION, FEE_UNITS, ZERO);
      expect(result.feesLockedNew).to.be.eq(PRECISION);
      expect(result.feesClaimable).to.be.eq(ZERO);

      result = await antiSnipAttack.calcFeeProportions(ZERO, PRECISION, FEE_UNITS.div(TWO), ZERO);
      expect(result.feesLockedNew).to.be.eq(PRECISION);
      expect(result.feesClaimable).to.be.eq(ZERO);
    });

    it('should return 0 feesClaimable for 0 feesClaimableVestedBps and feesSinceLastAction', async () => {
      let result = await antiSnipAttack.calcFeeProportions(PRECISION, ZERO, ZERO, FEE_UNITS);
      expect(result.feesLockedNew).to.be.eq(PRECISION);
      expect(result.feesClaimable).to.be.eq(ZERO);

      result = await antiSnipAttack.calcFeeProportions(PRECISION, ZERO, ZERO, FEE_UNITS.div(TWO));
      expect(result.feesLockedNew).to.be.eq(PRECISION);
      expect(result.feesClaimable).to.be.eq(ZERO);
    });

    it('should return 0 feesClaimable for 0 feesClaimableVestedBps and feesClaimableSinceLastActionBps', async () => {
      let result = await antiSnipAttack.calcFeeProportions(PRECISION, PRECISION, ZERO, ZERO);
      expect(result.feesLockedNew).to.be.eq(PRECISION.add(PRECISION));
      expect(result.feesClaimable).to.be.eq(ZERO);

      result = await antiSnipAttack.calcFeeProportions(PRECISION, ONE, ZERO, ZERO);
      expect(result.feesLockedNew).to.be.eq(PRECISION.add(ONE));
      expect(result.feesClaimable).to.be.eq(ZERO);
    });

    it('should return 0 feesLockedNew (all fees are claimable)', async () => {
      let result = await antiSnipAttack.calcFeeProportions(PRECISION, ZERO, FEE_UNITS, FEE_UNITS);
      expect(result.feesLockedNew).to.be.eq(ZERO);
      expect(result.feesClaimable).to.be.eq(PRECISION);

      result = await antiSnipAttack.calcFeeProportions(ONE, ZERO, FEE_UNITS, FEE_UNITS);
      expect(result.feesLockedNew).to.be.eq(ZERO);
      expect(result.feesClaimable).to.be.eq(ONE);

      result = await antiSnipAttack.calcFeeProportions(ZERO, PRECISION, FEE_UNITS, FEE_UNITS);
      expect(result.feesLockedNew).to.be.eq(ZERO);
      expect(result.feesClaimable).to.be.eq(PRECISION);

      result = await antiSnipAttack.calcFeeProportions(ZERO, ONE, FEE_UNITS, FEE_UNITS);
      expect(result.feesLockedNew).to.be.eq(ZERO);
      expect(result.feesClaimable).to.be.eq(ONE);
    });
  });

  describe('0 vesting period', async () => {
    it('should return feesSinceLastAction as feesClaimable', async () => {
      vestingPeriod = 0;
      await antiSnipAttack.initialize(currentTime);
      await antiSnipAttack.update(
        currentLiquidity,
        liquidityDelta,
        currentTime,
        true,
        feesSinceLastAction,
        vestingPeriod
      );
      let result = await antiSnipAttack.fees();
      expect(result.feesClaimable).to.be.eq(feesSinceLastAction);
      expect(result.feesBurnable).to.be.eq(ZERO);
    });
  });

  describe('non-zero vesting period', async () => {
    before('set vesting period to 100', async () => {
      vestingPeriod = 100;
    });

    beforeEach('initalize data, add liquidity', async () => {
      await antiSnipAttack.initialize(currentTime);
      await antiSnipAttack.update(
        currentLiquidity,
        liquidityDelta,
        currentTime,
        true,
        feesSinceLastAction,
        vestingPeriod
      );
    });

    describe('before vesting period ends', async () => {
      beforeEach('timeIncrement < vestingPeriod', async () => {
        incrementTime(genRandomBN(BN.from(1), BN.from(vestingPeriod)).toNumber());
      });

      it('should have non-zero fees locked', async () => {
        let result = await antiSnipAttack.data();
        expect(result.feesLocked).to.be.gt(ZERO);
      });

      it('should have non-zero fees claimable if adding more liquidity', async () => {
        await antiSnipAttack.update(
          currentLiquidity,
          liquidityDelta,
          currentTime,
          true,
          feesSinceLastAction,
          vestingPeriod
        );
        let result = await antiSnipAttack.fees();
        expect(result.feesClaimable).to.be.gt(ZERO);
      });

      it('should have updated lockTime and feesLocked if adding more liquidity', async () => {
        let lockTimeBefore = (await antiSnipAttack.data()).lockTime;
        await antiSnipAttack.update(
          currentLiquidity,
          liquidityDelta,
          currentTime,
          true,
          feesSinceLastAction,
          vestingPeriod
        );
        let result = await antiSnipAttack.data();
        expect(result.feesLocked).to.be.gt(ZERO);
        expect(result.lockTime).to.be.gt(lockTimeBefore);
      });

      it('should be able to handle multiple liquidity addition instances', async () => {
        // 5 instances
        for (let i = 0; i < 5; i++) {
          // move forward by randomly generated time
          let timeIncrement = genRandomBN(ONE, BN.from(vestingPeriod));
          let lockTimeBefore = (await antiSnipAttack.data()).lockTime;
          incrementTime(timeIncrement.toNumber());
          await antiSnipAttack.update(
            currentLiquidity,
            liquidityDelta,
            currentTime,
            true,
            feesSinceLastAction,
            vestingPeriod
          );
          let result = await antiSnipAttack.data();
          expect(result.lockTime).to.be.gt(lockTimeBefore);
          expect((await antiSnipAttack.fees()).feesClaimable).to.be.gt(ZERO);
        }
      });

      it('should have non-zero claimable and burnable fees when removing liquidity', async () => {
        await antiSnipAttack.update(
          currentLiquidity,
          liquidityDelta,
          currentTime,
          false,
          feesSinceLastAction,
          vestingPeriod
        );
        let result = await antiSnipAttack.fees();
        expect(result.feesClaimable).to.be.gt(ZERO);
        expect(result.feesBurnable).to.be.gt(ZERO);
      });
    });

    describe('at or after vesting period', async () => {
      beforeEach('timeIncrement >= vestingPeriod', async () => {
        incrementTime(genRandomBN(BN.from(vestingPeriod), BN.from(vestingPeriod * 5)).toNumber());
      });

      it('should have non-zero locked fees', async () => {
        let result = await antiSnipAttack.data();
        expect(result.feesLocked).to.be.gt(ZERO);
      });

      it('should have non-zero fees claimable if adding more liquidity', async () => {
        await antiSnipAttack.update(
          currentLiquidity,
          liquidityDelta,
          currentTime,
          true,
          feesSinceLastAction,
          vestingPeriod
        );
        let result = await antiSnipAttack.fees();
        expect(result.feesClaimable).to.be.gt(ZERO);
      });

      it('should have updated lockTime, zero feesLocked if adding more liquidity', async () => {
        let lockTimeBefore = (await antiSnipAttack.data()).lockTime;
        await antiSnipAttack.update(
          currentLiquidity,
          liquidityDelta,
          currentTime,
          true,
          feesSinceLastAction,
          vestingPeriod
        );
        let result = await antiSnipAttack.data();
        expect(result.feesLocked).to.be.eq(ZERO);
        expect(result.lockTime).to.be.gt(lockTimeBefore);
      });

      it('should be able to handle multiple liquidity addition instances', async () => {
        // 5 instances
        for (let i = 0; i < 5; i++) {
          // move forward by randomly generated time
          let timeIncrement = genRandomBN(BN.from(vestingPeriod), BN.from(vestingPeriod * 5));
          let lockTimeBefore = (await antiSnipAttack.data()).lockTime;
          incrementTime(timeIncrement.toNumber());
          await antiSnipAttack.update(
            currentLiquidity,
            liquidityDelta,
            currentTime,
            true,
            feesSinceLastAction,
            vestingPeriod
          );
          let result = await antiSnipAttack.data();
          expect(result.feesLocked).to.be.eq(ZERO);
          expect(result.lockTime).to.be.gt(lockTimeBefore);
          expect((await antiSnipAttack.fees()).feesClaimable).to.be.gt(ZERO);
        }
      });

      it('should have non-zero feesClaimable, 0 fees burnable when removing liquidity', async () => {
        await antiSnipAttack.update(
          currentLiquidity,
          liquidityDelta,
          currentTime,
          false,
          feesSinceLastAction,
          vestingPeriod
        );
        let result = await antiSnipAttack.fees();
        expect(result.feesClaimable).to.be.gt(ZERO);
        expect(result.feesBurnable).to.be.eq(ZERO);
      });
    });
  });

  describe('snipping', async () => {
    before('sets non-zero vesting period', async () => {
      vestingPeriod = 100;
    });

    beforeEach('initalize', async () => {
      await antiSnipAttack.initialize(currentTime);
    });

    it('should have 0 burnable fees for snipping if vesting period is 0', async () => {
      await antiSnipAttack.snip(currentLiquidity, liquidityDelta, currentTime, feesSinceLastAction, 0);
      let result = await antiSnipAttack.fees();
      expect(result.feesClaimable).to.be.gt(ZERO);
      expect(result.feesBurnable).to.be.eq(ZERO);
    });

    it('should have 0 feesClaimable and feesLocked, and non-zero fees burnable if snipping is performed', async () => {
      await antiSnipAttack.snip(ZERO, liquidityDelta, currentTime, feesSinceLastAction, vestingPeriod);
      let result = await antiSnipAttack.fees();
      expect(result.feesClaimable).to.be.eq(ZERO);
      expect(result.feesBurnable).to.be.gt(ZERO);
      expect((await antiSnipAttack.data()).feesLocked).to.be.eq(ZERO);
    });
  });

  describe('non-zero -> zero vesting period', async () => {
    it('should unlock any locked fees if vesting period is changed to 0', async () => {
      vestingPeriod = 100;
      await antiSnipAttack.initialize(currentTime);
      // increment time within vesting period to lock fees
      incrementTime(genRandomBN(BN.from(1), BN.from(vestingPeriod)).toNumber());
      // update for fees
      await antiSnipAttack.update(
        currentLiquidity,
        liquidityDelta,
        currentTime,
        true,
        feesSinceLastAction,
        vestingPeriod
      );
      // locked fees should be non-zero
      let data = await antiSnipAttack.data();
      let lockedFees = data.feesLocked;
      expect(lockedFees).to.be.gt(ZERO);
      // update with 0 vesting period
      vestingPeriod = 0;
      await antiSnipAttack.update(
        currentLiquidity,
        liquidityDelta,
        currentTime,
        true,
        feesSinceLastAction,
        vestingPeriod
      );
      data = await antiSnipAttack.data();
      // should be set to zero
      expect(data.feesLocked).to.be.eq(ZERO);
      // fees claimed should be equal to feesSinceLastAction + feesLocked
      let result = await antiSnipAttack.fees();
      expect(result.feesClaimable).to.be.eq(lockedFees.add(feesSinceLastAction));
      // zero fees burnable
      expect(result.feesBurnable).to.be.eq(ZERO);
    });
  });
});

function incrementTime(timeIncrement: number) {
  currentTime += timeIncrement;
}
