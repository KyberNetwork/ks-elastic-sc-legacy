import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {genRandomSeed} from '../helpers/genRandomBN';

import {MockLinkedlist, MockLinkedlist__factory} from '../../typechain';

const MIN_VALUE = -887272;
const MAX_VALUE = 887272;

let linkedlist: MockLinkedlist;
let realValues: Array<number>;

describe('Linkedlist', () => {
  before('setup', async () => {
    const Linkedlist = (await ethers.getContractFactory('MockLinkedlist')) as MockLinkedlist__factory;
    linkedlist = await Linkedlist.deploy(MIN_VALUE, MAX_VALUE);
    realValues = [MIN_VALUE, MAX_VALUE];
  });

  const validateValues = async () => {
    let currentValue = MIN_VALUE;
    for (let i = 0; i < realValues.length; i++) {
      expect(currentValue).to.be.eq(realValues[i]);
      let data = await linkedlist.getData(currentValue);
      // validate previous
      if (i == 0) expect(data.previous).to.be.eq(realValues[i]);
      else expect(data.previous).to.be.eq(realValues[i - 1]);
      // validate next
      if (i == realValues.length - 1) expect(data.next).to.be.eq(realValues[i]);
      else expect(data.next).to.be.eq(realValues[i + 1]);
      currentValue = data.next;
    }
  };

  it('correct initialized data', async () => {
    let data = await linkedlist.getData(MIN_VALUE);
    expect(data.previous).to.be.eq(MIN_VALUE);
    expect(data.next).to.be.eq(MAX_VALUE);
    data = await linkedlist.getData(MAX_VALUE);
    expect(data.previous).to.be.eq(MIN_VALUE);
    expect(data.next).to.be.eq(MAX_VALUE);
    await validateValues();
  });

  it('revert - insert with uninitialized lower value', async () => {
    await expect(linkedlist.insert(100, 1, 0)).to.be.revertedWith('lower value is not initialized'); // with an un-initialized lower value, the next value equal to 0
  });

  it('revert - insert invalid lower value', async () => {
    // we assume that passed lower value and next value are compatible with each other: lowerValue.next = nextVale
    await linkedlist.insert(100, MIN_VALUE, MAX_VALUE);
    realValues.splice(1, 0, 100);
    await expect(linkedlist.insert(1200, MIN_VALUE, 100)).to.be.revertedWith('invalid lower value');
    await linkedlist.insert(1200, 100, MAX_VALUE);
    realValues.splice(2, 0, 1200);
    await validateValues();
  });

  // it('revert - insert invalid next value', async () => {
  //   await linkedlist.insert(100, MIN_VALUE, MAX_VALUE);
  //   realValues.splice(1, 0, 100);
  //   await expect(linkedlist.insert(1200, 100, 1000)).to.be.revertedWith('invalid next value');
  //   await linkedlist.insert(1200, 100, MAX_VALUE);
  //   realValues.splice(2, 0, 1200);
  //   await validateValues();
  // });

  it('correct record insert data', async () => {
    for (let i = 0; i < 50; i++) {
      let t = genRandomSeed(realValues.length - 1);
      let x = realValues[t] + genRandomSeed(realValues[t + 1] - realValues[t]);
      if (x == realValues[t]) continue;
      await linkedlist.insert(x, realValues[t], realValues[t + 1]);
      realValues.splice(t + 1, 0, x);
      await validateValues();
    }
  });

  it('revert - remove nonexist value', async () => {
    for (let i = 0; i < 50; i++) {
      let t = genRandomSeed(realValues.length - 1);
      let x = realValues[t] + genRandomSeed(realValues[t + 1] - realValues[t]);
      if (x == realValues[t]) continue;
      await expect(linkedlist.remove(x)).to.be.revertedWith('remove non-existent value');
    }
  });

  it('remove at boundaries, nothing changes', async () => {
    await linkedlist.remove(MIN_VALUE);
    expect(await linkedlist.nearestRemovedValue()).to.be.eq(MIN_VALUE);
    await validateValues();
    await linkedlist.remove(MAX_VALUE);
    expect(await linkedlist.nearestRemovedValue()).to.be.eq(realValues[realValues.length - 2]);
    await validateValues();
  });

  it('correct record remove data', async () => {
    for (let i = 0; i < Math.min(10, realValues.length); i++) {
      let t = genRandomSeed(realValues.length - 1);
      if (t == 0 || t == realValues.length - 1) continue;
      await linkedlist.remove(realValues[t]);
      expect(await linkedlist.nearestRemovedValue()).to.be.eq(realValues[t - 1]);
      realValues.splice(t, 1);
      await validateValues();
    }
  });
});
