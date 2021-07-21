import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {ZERO, ONE, TWO_POW_96, TWO, PRECISION} from './helpers/helper';
import {convertReserveAmtsToSqrtPrice} from './helpers/utils';

import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {MockQtyDeltaMath, MockQtyDeltaMath__factory} from '../typechain';
import {snapshot, revertToSnapshot} from './helpers/hardhat';

let qtyDeltaMath: MockQtyDeltaMath;
let snapshotId: any;

describe('QtyDeltaMath', () => {
  before('setup', async () => {
    const qtyDeltaMathFactory = (await ethers.getContractFactory('MockQtyDeltaMath')) as MockQtyDeltaMath__factory;
    qtyDeltaMath = (await qtyDeltaMathFactory.deploy()) as MockQtyDeltaMath;
    snapshotId = await snapshot();
  });

  beforeEach('revert to snapshot', async () => {
    await revertToSnapshot(snapshotId);
    snapshotId = await snapshot();
  });

  describe('#getQty0Delta', async () => {
    it('should revert if price is 0', async () => {
      await expect(qtyDeltaMath.getQty0Delta(ZERO, TWO_POW_96, ONE)).to.be.revertedWith('0 sqrtPrice');
      await expect(qtyDeltaMath.getQty0Delta(TWO_POW_96, ZERO, ONE)).to.be.revertedWith('0 sqrtPrice');
    });

    it('should return 0 if liquidity is 0', async () => {
      expect(await qtyDeltaMath.getQty0Delta(TWO_POW_96, TWO_POW_96.mul(TWO), ZERO)).to.be.eql(ZERO);
    });

    it('should return 0 if prices are equal', async () => {
      expect(await qtyDeltaMath.getQty0Delta(TWO_POW_96, TWO_POW_96, PRECISION)).to.be.eql(ZERO);
    });

    // TODO: finish up testing
    // it('should return 0.2 amount0 if price increases by 20% twice (1.44x)', async () => {
    //   let result = await qtyDeltaMath.getQty0Delta(
    //     convertReserveAmtsToSqrtPrice(ONE, ONE),
    //     convertReserveAmtsToSqrtPrice(144, 100),
    //     PRECISION
    //   );
    // });
  });
});
