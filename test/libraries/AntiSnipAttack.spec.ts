import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {ZERO, ONE, TWO, BPS, PRECISION, TWO_POW_96} from '../helpers/helper';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {MockAntiSnipAttack, MockAntiSnipAttack__factory} from '../../typechain';
import { setNextBlockTimestampFromCurrent } from '../helpers/hardhat';

let antiSnipAttack: MockAntiSnipAttack;
let vestingPeriod: number;
let timeIncrement = 10;
let currentLiquidity = BPS.mul(TWO);
let liquidityDelta = BPS;
let feeGrowthInsideDifference = PRECISION.mul(TWO_POW_96);

describe('AntiSnipAttack', () => {
  before('setup', async () => {
    const antiSnipAttackFactory = (await ethers.getContractFactory(
      'MockAntiSnipAttack'
    )) as MockAntiSnipAttack__factory;
    antiSnipAttack = await antiSnipAttackFactory.deploy();
  });

  describe('#initialize', async () => {
    it('should be able to initialize data to default values', async () => {
        let data = await antiSnipAttack.data();
        expect(data.lastActionTime).to.be.eql(0);
        expect(data.lockTime).to.be.eql(0);
        expect(data.unlockTime).to.be.eql(0);
        expect(data.feesLocked).to.be.eql(ZERO);
        await antiSnipAttack.initialize();
        data = await antiSnipAttack.data();
        let expectedTimestamp = await antiSnipAttack.timestamp();
        expect(data.lastActionTime).to.be.eql(expectedTimestamp);
        expect(data.lockTime).to.be.eql(expectedTimestamp);
        expect(data.unlockTime).to.be.eql(expectedTimestamp);
        expect(data.feesLocked).to.be.eql(ZERO);
    });

    it('should initialize to new updated timestamp', async () => {
        await antiSnipAttack.initialize();
        // advance timestamp
        await setNextBlockTimestampFromCurrent(timeIncrement);
        // re-initialize
        await antiSnipAttack.initialize();
        let data = await antiSnipAttack.data();
        let expectedTimestamp = await antiSnipAttack.timestamp();
        expect(data.lastActionTime).to.be.eql(expectedTimestamp);
        expect(data.lockTime).to.be.eql(expectedTimestamp);
        expect(data.unlockTime).to.be.eql(expectedTimestamp);
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
    before('set vesting period to 0', async () => {
      vestingPeriod = 0;
    });

    beforeEach('initalize data', async () => {
      await antiSnipAttack.initialize();
    });

    it('should have zero fees locked, non-zero fees claimable', async () => {
      await antiSnipAttack.update(
        currentLiquidity,
        liquidityDelta,
        true,
        feeGrowthInsideDifference,
        vestingPeriod
      );
      let result = await antiSnipAttack.data();
      expect(result.feesLocked).to.be.eql(ZERO);
    });

    it('should have non-zero fees claimable, zero fees burnable', async () => {
      await antiSnipAttack.update(
        currentLiquidity,
        liquidityDelta,
        true,
        feeGrowthInsideDifference,
        vestingPeriod
      );
      let result = await antiSnipAttack.fees();
      expect(result.feesClaimable).to.be.gt(ZERO);
      expect(result.feesBurnable).to.be.eq(ZERO);
    });

    it('should have unlockTime = currentTime', async () => {
      await antiSnipAttack.update(
        currentLiquidity,
        liquidityDelta,
        true,
        feeGrowthInsideDifference,
        vestingPeriod
      );
      let result = await antiSnipAttack.data();
      expect(result.unlockTime).to.be.eql(await antiSnipAttack.timestamp());
    });

    it('should have 0 burnable fees for snipping', async () => {
      await antiSnipAttack.snip(
        currentLiquidity,
        liquidityDelta,
        feeGrowthInsideDifference,
        vestingPeriod
      );
      let result = await antiSnipAttack.fees();
      expect(result.feesClaimable).to.be.gt(ZERO);
      expect(result.feesBurnable).to.be.eq(ZERO);
    });
  });

  describe('non-zero vesting period', async () => {
    before('set vesting period to 100', async () => {
      vestingPeriod = 100;
    });

    beforeEach('initalize data', async () => {
      await antiSnipAttack.initialize();
    });
  });
});
