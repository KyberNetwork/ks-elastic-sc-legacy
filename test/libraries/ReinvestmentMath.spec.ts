import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {BN, ZERO, ONE, TWO, MAX_UINT, PRECISION} from '../helpers/helper';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {MockReinvestmentMath, MockReinvestmentMath__factory} from '../../typechain';
import {rm} from 'node:fs';

let mock: MockReinvestmentMath;

describe('ReinvestmentMath', () => {
  before('setup', async () => {
    const factory = (await ethers.getContractFactory('MockReinvestmentMath')) as MockReinvestmentMath__factory;
    mock = await factory.deploy();
  });

  describe('#calcrMintQtyInLiquidityDelta', async () => {
    it('basic test case', async () => {
      let rMint = await mock.calcrMintQtyInLiquidityDelta(
        PRECISION.div(BN.from(10)).mul(BN.from(11)),
        PRECISION,
        PRECISION.mul(BN.from(2)),
        PRECISION.mul(BN.from(10))
      );
      console.log(`rMint=${rMint.toString()}`); // 0.64516129032
    });

    it('lp=0 => rMint=0', async () => {
      let rMint = await mock.calcrMintQtyInLiquidityDelta(
        PRECISION.div(BN.from(10)).mul(BN.from(11)),
        PRECISION,
        ZERO,
        PRECISION.mul(BN.from(10))
      );
      expect(rMint).to.eq(ZERO);
    });
  });
});
