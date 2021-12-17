import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {ZERO, BN, MAX_TICK, MIN_TICK, ONE, NEGATIVE_ONE, BPS} from '../helpers/helper';
import chai from 'chai';
const {solidity, loadFixture} = waffle;
chai.use(solidity);

import {
  MockSimplePoolStorage,
  MockSimplePoolStorage__factory,
  InitializedTicksFetcher,
  InitializedTicksFetcher__factory,
} from '../../typechain';
import {BigNumberish} from '@ethersproject/bignumber';
import {genRandomBN} from '../helpers/genRandomBN';

let shortTickDistance = 100;
let longTickDistance = 10000;
let unloadedSimplePoolStorage: MockSimplePoolStorage;
let loadedSimplePoolStorageShort: MockSimplePoolStorage;
let loadedSimplePoolStorageLong: MockSimplePoolStorage;
let ticksFetcher: InitializedTicksFetcher;

function genMaxInitTicks(tickDistance: number) {
  let resultArr = [...Array(MAX_TICK.toNumber()).keys()].filter((x) => x % tickDistance == 0);
  let reversed = resultArr.slice().reverse();
  reversed.pop(); // remove duplicate 0
  reversed = reversed.map((x) => -x);
  return reversed.concat(resultArr);
}

function genRandomInitTicks(tickDistance: number) {
  let resultArr = genMaxInitTicks(tickDistance);
  // random number of elements to remove that is less than array length
  let numItemsToRemove = genRandomBN(ONE, BN.from(resultArr.length - 1)).toNumber();
  for (let i = numItemsToRemove; i >= 0; i--) {
    resultArr.splice(Math.floor(Math.random() * resultArr.length), 1);
  }
  return resultArr;
}

// note: doesnt compare array length
// will only compare elements in first array to match that of the second
// if second array has extra elements, they are ignored
function verifyArrays(firstArr: BigNumberish[], secondArr: BigNumberish[]) {
  for (let i = 0; i < firstArr.length; i++) {
    expect(firstArr[i]).to.be.eq(secondArr[i]);
  }
}

async function insertTicksByParts(mockSimplePoolStorage: MockSimplePoolStorage, arr: BigNumberish[]) {
  let i = 0;
  while (i < arr.length) {
    await mockSimplePoolStorage.insertTicks(arr.slice(i, i + 500));
    i += 500;
  }
}

class Fixtures {
  constructor(
    public unloadedSimplePoolStorage: MockSimplePoolStorage,
    public loadedSimplePoolStorageShort: MockSimplePoolStorage,
    public loadedSimplePoolStorageLong: MockSimplePoolStorage,
    public ticksFetcher: InitializedTicksFetcher
  ) {}
}

describe('InitializedTicksFetcher', () => {
  let allInitTicksShort = genMaxInitTicks(shortTickDistance);
  let allInitTicksLong = genMaxInitTicks(longTickDistance);
  async function fixture() {
    const MockSimplePoolStorageFactory = (await ethers.getContractFactory(
      'MockSimplePoolStorage'
    )) as MockSimplePoolStorage__factory;
    unloadedSimplePoolStorage = await MockSimplePoolStorageFactory.deploy(shortTickDistance);
    loadedSimplePoolStorageShort = await MockSimplePoolStorageFactory.deploy(shortTickDistance);
    await insertTicksByParts(loadedSimplePoolStorageShort, allInitTicksShort);
    loadedSimplePoolStorageLong = await MockSimplePoolStorageFactory.deploy(longTickDistance);
    await insertTicksByParts(loadedSimplePoolStorageLong, allInitTicksLong);

    // deploy InitializedTicksFetcher
    const InitializedTicksFetcherFactory = (await ethers.getContractFactory(
      'InitializedTicksFetcher'
    )) as InitializedTicksFetcher__factory;
    ticksFetcher = await InitializedTicksFetcherFactory.deploy();

    return new Fixtures(
      unloadedSimplePoolStorage,
      loadedSimplePoolStorageShort,
      loadedSimplePoolStorageLong,
      ticksFetcher
    );
  }

  beforeEach('load fixture', async () => {
    ({unloadedSimplePoolStorage, loadedSimplePoolStorageShort, loadedSimplePoolStorageLong, ticksFetcher} =
      await loadFixture(fixture));
  });

  describe('#getAllTicks', async () => {
    it('should return base case of [MIN_TICK, MAX_TICK]', async () => {
      verifyArrays([MIN_TICK, MAX_TICK], await ticksFetcher.getAllTicks(unloadedSimplePoolStorage.address));
    });

    it('should return [MIN_TICK, 0, MAX_TICK]', async () => {
      await unloadedSimplePoolStorage.insertTicks([ZERO]);
      verifyArrays([MIN_TICK, ZERO, MAX_TICK], await ticksFetcher.getAllTicks(unloadedSimplePoolStorage.address));
    });

    it('should return randomly generated sequential array for large tick distance', async () => {
      let resultArr = genRandomInitTicks(longTickDistance);
      await unloadedSimplePoolStorage.insertTicks(resultArr);
      verifyArrays(
        [MIN_TICK.toNumber()].concat(resultArr).concat([MAX_TICK.toNumber()]),
        await ticksFetcher.getAllTicks(unloadedSimplePoolStorage.address)
      );
    });

    it('should return full sequential array for large tick distance', async () => {
      verifyArrays(
        [MIN_TICK.toNumber()].concat(allInitTicksLong).concat([MAX_TICK.toNumber()]),
        await ticksFetcher.getAllTicks(loadedSimplePoolStorageLong.address)
      );
    });

    it('will run out of gas for small tick distance', async () => {
      try {
        await ticksFetcher.estimateGas.getAllTicks(loadedSimplePoolStorageShort.address);
      } catch (e) {}
    });
  });

  describe('#getTicksInRange', async () => {
    it('should return empty array for uninitialized start tick', async () => {
      let resultArr = await ticksFetcher.getTicksInRange(unloadedSimplePoolStorage.address, 0, 0);
      expect(resultArr.length).to.be.eq(ZERO);
      resultArr = await ticksFetcher.getTicksInRange(unloadedSimplePoolStorage.address, MIN_TICK.add(ONE), 0);
      expect(resultArr.length).to.be.eq(ZERO);
      resultArr = await ticksFetcher.getTicksInRange(unloadedSimplePoolStorage.address, MIN_TICK.sub(ONE), 0);
      expect(resultArr.length).to.be.eq(ZERO);
      resultArr = await ticksFetcher.getTicksInRange(unloadedSimplePoolStorage.address, 0, 100);
      expect(resultArr.length).to.be.eq(ZERO);
    });

    it('should return expected arrays for base case of [MIN_TICK, MAX_TICK]', async () => {
      let resultArr = await ticksFetcher.getTicksInRange(unloadedSimplePoolStorage.address, MIN_TICK, 1);
      verifyArrays([MIN_TICK], resultArr);
      resultArr = await ticksFetcher.getTicksInRange(unloadedSimplePoolStorage.address, MAX_TICK, 1);
      verifyArrays([MAX_TICK], resultArr);
      resultArr = await ticksFetcher.getTicksInRange(unloadedSimplePoolStorage.address, MIN_TICK, 2);
      verifyArrays([MIN_TICK, MAX_TICK], resultArr);
      resultArr = await ticksFetcher.getTicksInRange(unloadedSimplePoolStorage.address, MAX_TICK, 2);
      verifyArrays([MAX_TICK, ZERO], resultArr);
      resultArr = await ticksFetcher.getTicksInRange(unloadedSimplePoolStorage.address, MIN_TICK, 5);
      verifyArrays([MIN_TICK, MAX_TICK, ZERO, ZERO, ZERO], resultArr);
      resultArr = await ticksFetcher.getTicksInRange(unloadedSimplePoolStorage.address, MAX_TICK, 5);
      verifyArrays([MAX_TICK, ZERO, ZERO, ZERO, ZERO], resultArr);
    });

    it('should return desired array of fixed size for different starting initialized ticks and lengths', async () => {
      let resultArr = await ticksFetcher.getTicksInRange(loadedSimplePoolStorageShort.address, 0, 5);
      verifyArrays([0, 100, 200, 300, 400], resultArr);

      resultArr = await ticksFetcher.getTicksInRange(loadedSimplePoolStorageShort.address, MIN_TICK, 5);
      verifyArrays([MIN_TICK, -887200, -887100, -887000, -886900], resultArr);

      resultArr = await ticksFetcher.getTicksInRange(loadedSimplePoolStorageShort.address, -300, 5);
      verifyArrays([-300, -200, -100, 0, 100], resultArr);

      resultArr = await ticksFetcher.getTicksInRange(loadedSimplePoolStorageShort.address, 886900, 5);
      verifyArrays([886900, 887000, 887100, 887200, MAX_TICK], resultArr);

      resultArr = await ticksFetcher.getTicksInRange(loadedSimplePoolStorageShort.address, 887200, 5);
      verifyArrays([887200, MAX_TICK, 0, 0, 0], resultArr);

      let arrLength = 500;
      resultArr = await ticksFetcher.getTicksInRange(loadedSimplePoolStorageShort.address, MIN_TICK, arrLength);
      let expectedArr = [...Array(arrLength - 1).keys()].map((x) => -887200 + x * shortTickDistance);
      verifyArrays([MIN_TICK.toNumber()].concat(expectedArr), resultArr);
    });

    it('should return all ticks if specified length is 0, with appropriate starting tick', async () => {
      let resultArr = await ticksFetcher.getTicksInRange(unloadedSimplePoolStorage.address, MIN_TICK, 0);
      verifyArrays([MIN_TICK, MAX_TICK], resultArr);

      resultArr = await ticksFetcher.getTicksInRange(unloadedSimplePoolStorage.address, MAX_TICK, 0);
      verifyArrays([MAX_TICK], resultArr);

      let startTick = 700000;
      resultArr = await ticksFetcher.getTicksInRange(loadedSimplePoolStorageShort.address, startTick, 0);
      let expectedArr = [...Array(MAX_TICK.div(shortTickDistance)).keys()].map(
        (x) => startTick + x * shortTickDistance
      );
      verifyArrays(expectedArr, resultArr);
    });
  });

  describe('#getNearestInitializedTicks', async () => {
    describe('non-initialization ([MIN_TICK, MAX_TICK])', async () => {
      it('should return MIN_TICK and MAX_TICK regardless of queried tick (within range)', async () => {
        [MIN_TICK, MIN_TICK.add(ONE), NEGATIVE_ONE, ZERO, ONE, BPS, MAX_TICK.sub(ONE), MAX_TICK].forEach(
          async (tick) => {
            let nearestTicks = await ticksFetcher.getNearestInitializedTicks(unloadedSimplePoolStorage.address, tick);
            expect(nearestTicks.previous).to.be.eq(MIN_TICK);
            expect(nearestTicks.next).to.be.eq(MAX_TICK);
          }
        );
      });
    });

    describe('initalize all ticks for long tick distance', async () => {
      it('should return correct values for MIN_TICK', async () => {
        let nearestTicks = await ticksFetcher.getNearestInitializedTicks(
          loadedSimplePoolStorageLong.address,
          MIN_TICK
        );
        expect(nearestTicks.previous).to.be.eq(MIN_TICK);
        expect(nearestTicks.next).to.be.eq(-880000);
      });

      it('should return correct values for MAX_TICK', async () => {
        let nearestTicks = await ticksFetcher.getNearestInitializedTicks(
          loadedSimplePoolStorageLong.address,
          MAX_TICK
        );
        expect(nearestTicks.previous).to.be.eq(880000);
        expect(nearestTicks.next).to.be.eq(MAX_TICK);
      });

      it('should return correct values for other initialized ticks', async () => {
        let arr = allInitTicksLong.slice(1, -2);
        arr.forEach(async (tick) => {
          let nearestTicks = await ticksFetcher.getNearestInitializedTicks(loadedSimplePoolStorageLong.address, tick);
          expect(nearestTicks.previous).to.be.eq(tick - 10000);
          expect(nearestTicks.next).to.be.eq(tick + 10000);
        });
        // boundary cases
        let nearestTicks = await ticksFetcher.getNearestInitializedTicks(loadedSimplePoolStorageLong.address, -880000);
        expect(nearestTicks.previous).to.be.eq(MIN_TICK);
        expect(nearestTicks.next).to.be.eq(-870000);

        nearestTicks = await ticksFetcher.getNearestInitializedTicks(loadedSimplePoolStorageLong.address, 880000);
        expect(nearestTicks.previous).to.be.eq(870000);
        expect(nearestTicks.next).to.be.eq(MAX_TICK);
      });

      it('returns correct values for non-initialized ticks', async () => {
        for (let i = 0; i < 500; i++) {
          // gen random number between min and max ticks
          let randomTick = genRandomBN(MIN_TICK, MAX_TICK);
          while (randomTick.eq(MIN_TICK) || randomTick.eq(MAX_TICK) || randomTick.toNumber() % longTickDistance == 0) {
            randomTick = genRandomBN(MIN_TICK, MAX_TICK);
          }
          let nearestTicks = await ticksFetcher.getNearestInitializedTicks(
            loadedSimplePoolStorageLong.address,
            randomTick
          );
          expect(nearestTicks.previous).to.be.eq(
            Math.max(MIN_TICK.toNumber(), Math.floor(randomTick.toNumber() / longTickDistance) * longTickDistance)
          );
          expect(nearestTicks.next).to.be.eq(
            Math.min(MAX_TICK.toNumber(), Math.ceil(randomTick.toNumber() / longTickDistance) * longTickDistance)
          );
        }
      });
    });
  });
});
