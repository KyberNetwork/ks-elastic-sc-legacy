import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import chai from 'chai';
import {MAX_INT_128, MAX_UINT, MIN_INT_128, ONE, TWO} from '../helpers/helper';
const {solidity} = waffle;
chai.use(solidity);

import {MockSafeCast, MockSafeCast__factory} from '../../typechain';

let safeCast: MockSafeCast;
let SafeCast: MockSafeCast__factory;
let bits: number;

describe('SafeCast', () => {
  before('setup', async () => {
    SafeCast = (await ethers.getContractFactory('MockSafeCast')) as MockSafeCast__factory;
    safeCast = await SafeCast.deploy();
  });

  [32, 128, 160].forEach((bits) => testToUint(bits));

  function testToUint(bits: number) {
    describe(`uint256 -> toUint${bits}`, async () => {
      const maxValue = TWO.pow(bits).sub(ONE);

      it('should downcast 0', async () => {
        expect(await safeCast[`toUint${bits}`](0)).to.be.eq(0);
      });

      it('should downcast 1', async () => {
        expect(await safeCast[`toUint${bits}`](1)).to.be.eq(1);
      });

      it(`should downcast 2^${bits} - 1 (${maxValue})`, async () => {
        expect(await safeCast[`toUint${bits}`](maxValue)).to.be.eq(maxValue);
      });

      it(`should revert when downcasting 2^${bits} (${maxValue.add(ONE)})`, async () => {
        await expect(safeCast[`toUint${bits}`](maxValue.add(ONE))).to.be.reverted;
      });

      it(`should revert when downcasting 2^${bits} + 1 (${maxValue.add(TWO)})`, async () => {
        await expect(safeCast[`toUint${bits}`](maxValue.add(TWO))).to.be.reverted;
      });
    });
  }

  [128, 256].forEach((bits) => testRevToUint(bits));

  function testRevToUint(bits: number) {
    describe(`int${bits} -> revToUint${bits}`, async () => {
      const minValue = TWO.pow(bits - 1).mul(-1);
      const maxValue = TWO.pow(bits - 1).sub(ONE);

      it(`should cast 0`, async () => {
        expect(await safeCast[`revToUint${bits}`](0)).to.be.eq(0);
      });

      it(`should return 1 for -1`, async () => {
        expect(await safeCast[`revToUint${bits}`](-1)).to.be.eq(1);
      });

      it(`should return 2^${bits - 1} for -2^${bits - 1} (${minValue})`, async () => {
        expect(await safeCast[`revToUint${bits}`](minValue)).to.be.eq(minValue.mul(-1));
      });

      it(`will return 2^${bits} - 1 for 1`, async () => {
        expect(await safeCast[`revToUint${bits}`](1)).to.be.eq(TWO.pow(bits).sub(ONE));
      });

      it(`will return 2^${bits} + 1 for 2^${bits} - 1 (${maxValue})`, async () => {
        expect(await safeCast[`revToUint${bits}`](maxValue)).to.be.eq(maxValue.add(TWO));
      });
    });
  }

  [128, 256].forEach((bits) => testToInt(bits));

  function testToInt(bits: number) {
    describe(`uint${bits} -> toInt${bits}`, async () => {
      const maxValue = TWO.pow(bits - 1).sub(ONE);

      it('should downcast 0', async function () {
        expect(await safeCast[`toInt${bits}`](0)).to.be.eq(0);
      });

      it('should downcast 1', async function () {
        expect(await safeCast[`toInt${bits}`](1)).to.be.eq(1);
      });

      it(`should downcast 2^255 - 1 (${maxValue})`, async () => {
        expect(await safeCast[`toInt${bits}`](maxValue)).to.be.eq(maxValue);
      });

      it(`reverts when downcasting 2^255 (${maxValue.add(ONE)})`, async () => {
        await expect(safeCast[`toInt${bits}`](maxValue.add(ONE))).to.be.reverted;
      });

      it(`reverts when downcasting 2^255 + 1 (${maxValue.add(TWO)})`, async () => {
        await expect(safeCast[`toInt${bits}`](maxValue.add(TWO))).to.be.reverted;
      });
    });
  }

  describe(`uint256 -> revToInt256`, async () => {
    const maxValue = TWO.pow(255).sub(ONE);

    it('should cast 0', async () => {
      expect(await safeCast.revToInt256(0)).to.be.eq(0);
    });

    it(`should return -1 for 1`, async () => {
      expect(await safeCast.revToInt256(1)).to.be.eq(-1);
    });

    it(`should return -(2^255 - 1) for 2^255 - 1 (${maxValue})`, async () => {
      expect(await safeCast.revToInt256(maxValue)).to.be.eq(maxValue.mul(-1));
    });

    it(`reverts for 2^255 (${maxValue.add(ONE)})`, async () => {
      await expect(safeCast.revToInt256(maxValue.add(ONE))).to.be.reverted;
    });

    it(`reverts for 2^255 + 1 (${maxValue.add(TWO)})`, async () => {
      await expect(safeCast.revToInt256(maxValue.add(TWO))).to.be.reverted;
    });

    it(`reverts for MAX_UINT (2^256 - 1)`, async () => {
      await expect(safeCast.revToInt256(MAX_UINT)).to.be.reverted;
    });
  });
});
