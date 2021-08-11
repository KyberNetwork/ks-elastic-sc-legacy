import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {ZERO, ONE, TWO, TWO_POW_96, PRECISION, MAX_INT_128, MAX_UINT} from './helpers/helper';
import chai from 'chai';
const {solidity, loadFixture} = waffle;
chai.use(solidity);

import {MockPosition__factory, MockPosition} from '../typechain';
import {snapshot, revertToSnapshot} from './helpers/hardhat';

let position: MockPosition;
let user: any;
let tickLower = 10;
let tickUpper = 20;
let liquidityDelta = PRECISION;
let feeGrowthInside = TWO_POW_96;
let snapshotId: any;

describe('Position', () => {
  [user] = waffle.provider.getWallets();

  async function fixture() {
    const PositionFactory = (await ethers.getContractFactory('MockPosition')) as MockPosition__factory;
    return (await PositionFactory.deploy()) as MockPosition;
  }

  beforeEach('position setup', async () => {
    position = await loadFixture(fixture);
  });

  describe('test updating position', async () => {
    it('should return 0 values for empty position', async () => {
      let result = await position.get(user.address, tickLower, tickUpper);
      expect(result.liquidity).to.be.eql(ZERO);
      expect(result.feeGrowthInsideLast).to.be.eql(ZERO);
    });

    it('should be able to update position', async () => {
      // add liquidity
      await position.update(user.address, tickLower, tickUpper, liquidityDelta, feeGrowthInside);
      let result = await position.get(user.address, tickLower, tickUpper);
      expect(result.liquidity).to.be.eql(liquidityDelta);
      expect(result.feeGrowthInsideLast).to.be.eql(feeGrowthInside);

      // remove liquidity
      await position.update(user.address, tickLower, tickUpper, liquidityDelta.mul(-1), feeGrowthInside.mul(TWO));
      result = await position.get(user.address, tickLower, tickUpper);
      expect(result.liquidity).to.be.eql(ZERO);
      expect(result.feeGrowthInsideLast).to.be.eql(feeGrowthInside.mul(TWO));
    });
  });

  describe('test rTokensOwed', async () => {
    it('should revert if feeGrowthInside < feeGrowthInsideLast', async () => {
      await position.update(user.address, tickLower, tickUpper, liquidityDelta, feeGrowthInside);
      await expect(position.update(user.address, tickLower, tickUpper, liquidityDelta, ZERO)).to.be.reverted;
      await expect(position.update(user.address, tickLower, tickUpper, liquidityDelta, feeGrowthInside.sub(ONE))).to.be
        .reverted;
    });

    it('should return 0 rTokensOwed if current liquidity is zero', async () => {
      await position.update(user.address, tickLower, tickUpper, ZERO, feeGrowthInside);
      expect(await position.rTokensOwed()).to.be.eql(ZERO);
      // added liquidity, but since current liquidity is 0, rTokensOwed should be 0
      // even if feeGrowthInside increased
      await position.update(user.address, tickLower, tickUpper, liquidityDelta, feeGrowthInside.mul(2));
      expect(await position.rTokensOwed()).to.be.eql(ZERO);
    });

    it('should return 0 rTokensOwed if feeGrowthInside = feeGrowthInsideLast', async () => {
      await position.update(user.address, tickLower, tickUpper, liquidityDelta, feeGrowthInside);
      await position.update(user.address, tickLower, tickUpper, liquidityDelta, feeGrowthInside);
      expect(await position.rTokensOwed()).to.be.eql(ZERO);
    });

    it('should return rTokensOwed > 0 if feeGrowthInside > feeGrowthInsideLast with unchanged liquidity', async () => {
      await position.update(user.address, tickLower, tickUpper, liquidityDelta, feeGrowthInside);
      await position.update(user.address, tickLower, tickUpper, liquidityDelta, feeGrowthInside.mul(2));
      expect(await position.rTokensOwed()).to.be.gt(ZERO);
    });

    it('should return rTokensOwed > 0 if user fully removes liquidity', async () => {
      await position.update(user.address, tickLower, tickUpper, liquidityDelta, feeGrowthInside);
      await position.update(user.address, tickLower, tickUpper, ZERO, feeGrowthInside.mul(2));
      expect(await position.rTokensOwed()).to.be.gt(ZERO);
    });

    it('should test max feeGrowth difference = MAX_UINT * TWO_POW_96 / MAX_INT_128', async () => {
      let feeGrowthDiff = MAX_UINT.mul(TWO_POW_96).div(MAX_INT_128);
      await position.update(user.address, tickLower, tickUpper, MAX_INT_128, ZERO);
      // take snapshot to revert to it later
      let tempSnapshotId = await snapshot();
      await position.update(user.address, tickLower, tickUpper, ZERO, feeGrowthDiff);
      // due to rounding error
      expect(await position.rTokensOwed()).to.be.gt(MAX_UINT.sub(5));

      // revert to snapshot
      await revertToSnapshot(tempSnapshotId);
      // will revert from overflow
      feeGrowthDiff = feeGrowthDiff.add(ONE);
      await expect(position.update(user.address, tickLower, tickUpper, ZERO, feeGrowthDiff)).to.be.revertedWith(
        'denom <= prod1'
      );
    });
  });
});
