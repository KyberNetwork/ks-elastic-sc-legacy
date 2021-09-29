import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {ZERO, ONE, TWO, BPS, PRECISION, BN} from '../helpers/helper';
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
let feesSinceLastAction = BPS;

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
      expect(data.lastActionTime).to.be.eql(0);
      expect(data.lockTime).to.be.eql(0);
      expect(data.unlockTime).to.be.eql(0);
      expect(data.feesLocked).to.be.eql(ZERO);
      await antiSnipAttack.initialize(currentTime);
      data = await antiSnipAttack.data();
      expect(data.lastActionTime).to.be.eql(currentTime);
      expect(data.lockTime).to.be.eql(currentTime);
      expect(data.unlockTime).to.be.eql(currentTime);
      expect(data.feesLocked).to.be.eql(ZERO);
    });

    it('should initialize to new updated timestamp', async () => {
      await antiSnipAttack.initialize(currentTime);
      incrementTime(30);
      // re-initialize with new timestamp
      await antiSnipAttack.initialize(currentTime);
      let data = await antiSnipAttack.data();
      expect(data.lastActionTime).to.be.eql(currentTime);
      expect(data.lockTime).to.be.eql(currentTime);
      expect(data.unlockTime).to.be.eql(currentTime);
      expect(data.feesLocked).to.be.eql(ZERO);
    });
  });

  describe('#calcFeeProportions', async () => {
    it('should return 0 for 0 fees', async () => {
      let result = await antiSnipAttack.calcFeeProportions(ZERO, ZERO, ZERO, ZERO);
      expect(result.feesLockedNew).to.be.eql(ZERO);
      expect(result.feesClaimable).to.be.eql(ZERO);

      result = await antiSnipAttack.calcFeeProportions(ZERO, ZERO, BPS, BPS);
      expect(result.feesLockedNew).to.be.eql(ZERO);
      expect(result.feesClaimable).to.be.eql(ZERO);

      result = await antiSnipAttack.calcFeeProportions(ZERO, ZERO, ZERO, BPS);
      expect(result.feesLockedNew).to.be.eql(ZERO);
      expect(result.feesClaimable).to.be.eql(ZERO);

      result = await antiSnipAttack.calcFeeProportions(ZERO, ZERO, BPS, ZERO);
      expect(result.feesLockedNew).to.be.eql(ZERO);
      expect(result.feesClaimable).to.be.eql(ZERO);

      result = await antiSnipAttack.calcFeeProportions(ZERO, ZERO, ZERO, ONE);
      expect(result.feesLockedNew).to.be.eql(ZERO);
      expect(result.feesClaimable).to.be.eql(ZERO);

      result = await antiSnipAttack.calcFeeProportions(ZERO, ZERO, ONE, ZERO);
      expect(result.feesLockedNew).to.be.eql(ZERO);
      expect(result.feesClaimable).to.be.eql(ZERO);
    });

    it('should return 0 feesClaimable for 0 feesClaimableSinceLastActionBps and feesLockedCurrent', async () => {
      let result = await antiSnipAttack.calcFeeProportions(ZERO, PRECISION, BPS, ZERO);
      expect(result.feesLockedNew).to.be.eql(PRECISION);
      expect(result.feesClaimable).to.be.eql(ZERO);

      result = await antiSnipAttack.calcFeeProportions(ZERO, PRECISION, BPS.div(TWO), ZERO);
      expect(result.feesLockedNew).to.be.eql(PRECISION);
      expect(result.feesClaimable).to.be.eql(ZERO);
    });

    it('should return 0 feesClaimable for 0 feesClaimableVestedBps and feesSinceLastAction', async () => {
      let result = await antiSnipAttack.calcFeeProportions(PRECISION, ZERO, ZERO, BPS);
      expect(result.feesLockedNew).to.be.eql(PRECISION);
      expect(result.feesClaimable).to.be.eql(ZERO);

      result = await antiSnipAttack.calcFeeProportions(PRECISION, ZERO, ZERO, BPS.div(TWO));
      expect(result.feesLockedNew).to.be.eql(PRECISION);
      expect(result.feesClaimable).to.be.eql(ZERO);
    });

    it('should return 0 feesClaimable for 0 feesClaimableVestedBps and feesClaimableSinceLastActionBps', async () => {
      let result = await antiSnipAttack.calcFeeProportions(PRECISION, PRECISION, ZERO, ZERO);
      expect(result.feesLockedNew).to.be.eql(PRECISION.add(PRECISION));
      expect(result.feesClaimable).to.be.eql(ZERO);

      result = await antiSnipAttack.calcFeeProportions(PRECISION, ONE, ZERO, ZERO);
      expect(result.feesLockedNew).to.be.eql(PRECISION.add(ONE));
      expect(result.feesClaimable).to.be.eql(ZERO);
    });

    it('should return 0 feesLockedNew (all fees are claimable)', async () => {
      let result = await antiSnipAttack.calcFeeProportions(PRECISION, ZERO, BPS, BPS);
      expect(result.feesLockedNew).to.be.eql(ZERO);
      expect(result.feesClaimable).to.be.eql(PRECISION);

      result = await antiSnipAttack.calcFeeProportions(ONE, ZERO, BPS, BPS);
      expect(result.feesLockedNew).to.be.eql(ZERO);
      expect(result.feesClaimable).to.be.eql(ONE);

      result = await antiSnipAttack.calcFeeProportions(ZERO, PRECISION, BPS, BPS);
      expect(result.feesLockedNew).to.be.eql(ZERO);
      expect(result.feesClaimable).to.be.eql(PRECISION);

      result = await antiSnipAttack.calcFeeProportions(ZERO, ONE, BPS, BPS);
      expect(result.feesLockedNew).to.be.eql(ZERO);
      expect(result.feesClaimable).to.be.eql(ONE);
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
      expect(result.feesClaimable).to.be.eql(feesSinceLastAction);
      expect(result.feesBurnable).to.be.eql(ZERO);
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
          // gradually becomes zero the longer the position stays
          expect(result.feesLocked).to.be.gte(ZERO);
          expect(result.lockTime).to.be.gt(lockTimeBefore);
          expect((await antiSnipAttack.fees()).feesClaimable).to.be.gt(ZERO);
        }
      });

      it('should have non-zero claimable and burnable fees if liquidity is removed', async () => {
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

    describe('at vesting period', async () => {});

    describe('after vesting period', async () => {});
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
});

function incrementTime(timeIncrement: number) {
  currentTime += timeIncrement;
}
