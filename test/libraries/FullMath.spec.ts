import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {ZERO, ONE, TWO, TWO_POW_128, MAX_UINT, BN} from '../helpers/helper';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {MockFullMath, MockFullMath__factory} from '../../typechain';
import {genRandomBNWithPossibleZero} from '../helpers/genRandomBN';

let fullMath: MockFullMath;

describe('FullMath', () => {
  before('setup', async () => {
    const fullMathFactory = (await ethers.getContractFactory('MockFullMath')) as MockFullMath__factory;
    fullMath = await fullMathFactory.deploy();
  });

  describe('#mulDivFloor', async () => {
    it('should revert for 0 denominator', async () => {
      await expect(fullMath.mulDivFloor(TWO_POW_128, 5, 0)).to.be.revertedWith('0 denom');
      await expect(fullMath.mulDivFloor(TWO_POW_128, ZERO, ZERO)).to.be.revertedWith('0 denom');
      await expect(fullMath.mulDivFloor(ZERO, TWO_POW_128, ZERO)).to.be.revertedWith('0 denom');
      await expect(fullMath.mulDivFloor(ZERO, ZERO, ZERO)).to.be.revertedWith('0 denom');
    });

    it('should revert for overflow numerator and 0 denominator', async () => {
      await expect(fullMath.mulDivFloor(TWO_POW_128, TWO_POW_128, ZERO)).to.be.revertedWith('denom <= prod1');
    });

    it('should revert if result overflows', async () => {
      await expect(fullMath.mulDivFloor(TWO_POW_128, TWO_POW_128, ONE)).to.be.revertedWith('denom <= prod1');
    });

    it('should revert for MAX_UINT * MAX_UINT / (MAX_UINT - 1)', async () => {
      await expect(fullMath.mulDivFloor(MAX_UINT, MAX_UINT, MAX_UINT.sub(ONE))).to.be.revertedWith('denom <= prod1');
    });

    it('should return MAX_UINT for max inputs', async () => {
      expect(await fullMath.mulDivFloor(MAX_UINT, MAX_UINT, MAX_UINT)).to.be.eq(MAX_UINT);
    });

    it('should return accurate value without phantom overflow', async () => {
      const result = TWO_POW_128.div(TWO);
      expect(await fullMath.mulDivFloor(TWO_POW_128, TWO, TWO.mul(TWO))).to.be.eq(result);
      expect(await fullMath.mulDivFloor(TWO_POW_128, ONE, TWO)).to.be.eq(result);
      expect(await fullMath.mulDivFloor(TWO_POW_128, 5000, 10000)).to.be.eq(result);

      expect(
        await fullMath.mulDivFloor(
          TWO_POW_128,
          /*0.5=*/ BN.from(50).mul(TWO_POW_128).div(100),
          /*1.5=*/ BN.from(150).mul(TWO_POW_128).div(100)
        )
      ).to.eq(TWO_POW_128.div(3));
    });

    it('should return accurate value with phantom overflow', async () => {
      let result = TWO_POW_128.mul(1000);
      expect(await fullMath.mulDivFloor(TWO_POW_128.mul(1000), TWO_POW_128.mul(1000), TWO_POW_128.mul(1000))).to.be.eq(
        result
      );

      result = TWO_POW_128.mul(8750).div(10000);
      expect(await fullMath.mulDivFloor(TWO_POW_128, TWO_POW_128.mul(8750), TWO_POW_128.mul(10000))).to.be.eq(result);
      expect(await fullMath.mulDivFloor(TWO_POW_128.mul(175), TWO_POW_128.mul(50), TWO_POW_128.mul(10000))).to.be.eq(
        result
      );

      result = TWO_POW_128.mul(87500).div(10000);
      expect(await fullMath.mulDivFloor(TWO_POW_128, TWO_POW_128.mul(87500), TWO_POW_128.mul(10000))).to.be.eq(result);
      expect(await fullMath.mulDivFloor(TWO_POW_128, TWO_POW_128.mul(70), TWO_POW_128.mul(8))).to.be.eq(result);
    });

    it('should return accurate value for repeating decimals', async () => {
      let result = TWO_POW_128.div(3);
      expect(await fullMath.mulDivFloor(TWO_POW_128, ONE, 3)).to.be.eq(result);
      expect(await fullMath.mulDivFloor(TWO_POW_128, 5000, 15000)).to.be.eq(result);

      result = TWO_POW_128.mul(2).div(3);
      expect(await fullMath.mulDivFloor(TWO_POW_128, TWO, 3)).to.be.eq(result);
      expect(await fullMath.mulDivFloor(TWO_POW_128, 10000, 15000)).to.be.eq(result);

      result = TWO_POW_128.div(7);
      expect(await fullMath.mulDivFloor(TWO_POW_128, ONE, 7)).to.be.eq(result);
      expect(await fullMath.mulDivFloor(TWO_POW_128, TWO_POW_128.mul(10000), TWO_POW_128.mul(70000))).to.be.eq(result);
    });
  });

  describe('#mulDivCeiling', async () => {
    it('should revert for 0 denominator', async () => {
      await expect(fullMath.mulDivCeiling(TWO_POW_128, ZERO, ZERO)).to.be.revertedWith('0 denom');
      await expect(fullMath.mulDivCeiling(ZERO, TWO_POW_128, ZERO)).to.be.revertedWith('0 denom');
      await expect(fullMath.mulDivFloor(ZERO, ZERO, ZERO)).to.be.revertedWith('0 denom');
    });

    it('should revert for overflow numerator and 0 denominator', async () => {
      await expect(fullMath.mulDivCeiling(TWO_POW_128, TWO_POW_128, ZERO)).to.be.revertedWith('denom <= prod1');
    });

    it('should revert if result overflows', async () => {
      await expect(fullMath.mulDivCeiling(TWO_POW_128, TWO_POW_128, ONE)).to.be.revertedWith('denom <= prod1');
    });

    it('should revert for MAX_UINT * MAX_UINT / (MAX_UINT - 1)', async () => {
      await expect(fullMath.mulDivCeiling(MAX_UINT, MAX_UINT, MAX_UINT.sub(ONE))).to.be.revertedWith('denom <= prod1');
    });

    it('should return MAX_UINT for max inputs', async () => {
      expect(await fullMath.mulDivCeiling(MAX_UINT, MAX_UINT, MAX_UINT)).to.be.eq(MAX_UINT);
    });

    it('should revert if mulDivFloor overflows after rounding up', async () => {
      // mulDivFloor will hit MAX_UINT
      await fullMath.mulDivFloor(
        '115790931316423822261616749298837820974191451965793907633817189432073050508639',
        100000,
        99999
      );
      // overflows upon rounding up
      await expect(
        fullMath.mulDivCeiling(
          '115790931316423822261616749298837820974191451965793907633817189432073050508639',
          100000,
          99999
        )
      ).to.be.reverted;

      await fullMath.mulDivFloor(
        535006138814359,
        '432862656469423142931042426214547535783388063929571229938474969',
        2
      );
      // overflows upon rounding up
      await expect(
        fullMath.mulDivCeiling(535006138814359, '432862656469423142931042426214547535783388063929571229938474969', 2)
      ).to.be.reverted;
    });

    it('should return accurate value without phantom overflow', async () => {
      let result = TWO_POW_128.div(TWO);
      expect(await fullMath.mulDivCeiling(TWO_POW_128, TWO, TWO.mul(TWO))).to.be.eq(result);
      expect(await fullMath.mulDivCeiling(TWO_POW_128, ONE, TWO)).to.be.eq(result);
      expect(await fullMath.mulDivCeiling(TWO_POW_128, 5000, 10000)).to.be.eq(result);
    });

    it('should return accurate value with phantom overflow', async () => {
      let result = TWO_POW_128.mul(1000);
      expect(
        await fullMath.mulDivCeiling(TWO_POW_128.mul(1000), TWO_POW_128.mul(1000), TWO_POW_128.mul(1000))
      ).to.be.eq(result);

      result = TWO_POW_128.mul(8750).div(10000);
      expect(await fullMath.mulDivCeiling(TWO_POW_128, TWO_POW_128.mul(8750), TWO_POW_128.mul(10000))).to.be.eq(
        result
      );
      expect(await fullMath.mulDivCeiling(TWO_POW_128.mul(175), TWO_POW_128.mul(50), TWO_POW_128.mul(10000))).to.be.eq(
        result
      );

      result = TWO_POW_128.mul(87500).div(10000);
      expect(await fullMath.mulDivCeiling(TWO_POW_128, TWO_POW_128.mul(87500), TWO_POW_128.mul(10000))).to.be.eq(
        result
      );
      expect(await fullMath.mulDivCeiling(TWO_POW_128, TWO_POW_128.mul(70), TWO_POW_128.mul(8))).to.be.eq(result);
    });

    it('should return accurate value for repeating decimals', async () => {
      let result = TWO_POW_128.div(3).add(ONE);
      expect(await fullMath.mulDivCeiling(TWO_POW_128, ONE, 3)).to.be.eq(result);
      expect(await fullMath.mulDivCeiling(TWO_POW_128, 5000, 15000)).to.be.eq(result);

      result = TWO_POW_128.mul(2).div(3).add(ONE);
      expect(await fullMath.mulDivCeiling(TWO_POW_128, TWO, 3)).to.be.eq(result);
      expect(await fullMath.mulDivCeiling(TWO_POW_128, 10000, 15000)).to.be.eq(result);

      result = TWO_POW_128.div(7).add(ONE);
      expect(await fullMath.mulDivCeiling(TWO_POW_128, ONE, 7)).to.be.eq(result);
      expect(await fullMath.mulDivCeiling(TWO_POW_128, TWO_POW_128.mul(10000), TWO_POW_128.mul(70000))).to.be.eq(
        result
      );
    });
  });

  // tiny fuzzer. unskip to run
  it.skip('checks some randomly generated inputs against JS implementation', async () => {
    // generate random inputs and test against it
    const NUM_TESTS = 10000;
    const chance = 5;
    for (let i = 0; i < NUM_TESTS; i++) {
      let a = genRandomBNWithPossibleZero(chance, MAX_UINT);
      let b = genRandomBNWithPossibleZero(chance, MAX_UINT);
      let denom = genRandomBNWithPossibleZero(chance, MAX_UINT);
      console.log(`a: ${a.toString()}`);
      console.log(`b: ${b.toString()}`);
      console.log(`denom: ${denom.toString()}`);
      let floor = fullMath.mulDivFloor(a, b, denom);
      let ceiling = fullMath.mulDivCeiling(a, b, denom);

      if (denom.eq(ZERO)) {
        let revertReason: string = a.mul(b).gt(MAX_UINT) ? 'denom <= prod1' : '0 denom';
        await expect(floor).to.be.revertedWith(revertReason);
        await expect(ceiling).to.be.revertedWith(revertReason);
        continue;
      }

      if (a.eq(ZERO) || b.eq(ZERO)) {
        expect(await floor).to.eq(ZERO);
        expect(await ceiling).to.eq(ZERO);
      } else if (a.mul(b).div(denom).gt(MAX_UINT.add(ONE))) {
        await expect(floor).to.be.revertedWith('denom <= prod1');
        await expect(ceiling).to.be.revertedWith('denom <= prod1');
      } else {
        expect(await floor).to.eq(a.mul(b).div(denom));
        expect(await ceiling).to.eq(
          a
            .mul(b)
            .div(denom)
            .add(a.mul(b).mod(denom).gt(ZERO) ? ONE : ZERO)
        );
      }
    }
  });
});
