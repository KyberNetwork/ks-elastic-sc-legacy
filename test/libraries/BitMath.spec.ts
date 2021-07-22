import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {BN, ZERO, ONE, TWO, MAX_UINT} from '../helpers/helper';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {MockBitMath, MockBitMath__factory} from '../../typechain';

let bitMath: MockBitMath;

describe('BitMath', () => {
  before('setup', async () => {
    const bitMathFactory = (await ethers.getContractFactory('MockBitMath')) as MockBitMath__factory;
    bitMath = await bitMathFactory.deploy();
  });

  describe('#mostSignificantBit', async () => {
    it('should revert for input 0', async () => {
      await expect(bitMath.mostSignificantBit(ZERO)).to.be.reverted;
    });

    it('should return 0 for input 1', async () => {
      expect(await bitMath.mostSignificantBit(ONE)).to.be.eql(0);
    });

    it('should return 1 for input 2', async () => {
      expect(await bitMath.mostSignificantBit(TWO)).to.be.eql(1);
    });

    it('should return 1 less for all powers of 2', async () => {
      for (let i = 2; i < 256; i++) {
        expect(await bitMath.mostSignificantBit(TWO.pow(BN.from(i)))).to.be.eql(i);
      }
    });

    it('should return 255 for MAX_UINT', async () => {
      expect(await bitMath.mostSignificantBit(MAX_UINT)).to.be.eql(255);
    });
  });

  describe('#leastSignificantBit', async () => {
    it('should revert for input 0', async () => {
      await expect(bitMath.leastSignificantBit(ZERO)).to.be.reverted;
    });

    it('should return 0 for input 1', async () => {
      expect(await bitMath.leastSignificantBit(ONE)).to.be.eql(0);
    });

    it('should return 1 for input 2', async () => {
      expect(await bitMath.leastSignificantBit(TWO)).to.be.eql(1);
    });

    it('should return 1 less for all powers of 2', async () => {
      for (let i = 2; i < 256; i++) {
        expect(await bitMath.leastSignificantBit(TWO.pow(BN.from(i)))).to.be.eql(i);
      }
    });

    it('should return 0 for all powers of 2 minus 1', async () => {
      for (let i = 2; i < 256; i++) {
        expect(await bitMath.leastSignificantBit(TWO.pow(BN.from(i)).sub(ONE))).to.be.eql(0);
      }
    });

    it('should return 0 for MAX_UINT', async () => {
      expect(await bitMath.leastSignificantBit(MAX_UINT)).to.be.eql(0);
    });
  });
});
