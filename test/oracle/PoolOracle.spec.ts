import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {BigNumber as BN, ContractTransaction} from 'ethers';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {PoolOracle, PoolOracle__factory} from '../../typechain';
import {MockToken, MockToken__factory} from '../../typechain';

import {snapshot, revertToSnapshot} from '../helpers/hardhat';

let Token: MockToken__factory;
let tokenA: MockToken;
let PoolOracleContract: PoolOracle__factory
let poolOracle: PoolOracle
let defaultLiquidity = BN.from(10);

let snapshotId: any;

describe('PoolOracle', () => {
  const [user, admin] = waffle.provider.getWallets();

  before('pool oracle setup', async () => {
    Token = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    tokenA = await Token.deploy('USDC', 'USDC', BN.from(1000000));
    PoolOracleContract = (await ethers.getContractFactory('PoolOracle')) as PoolOracle__factory;

    poolOracle = await PoolOracleContract.connect(admin).deploy();
    await poolOracle.initialize();
    expect(await poolOracle.owner()).to.be.eq(admin.address);

    snapshotId = await snapshot();
  });

  const verifyStoredObservation = async (
    pool: string, _initialized: boolean,
    _index: number, _cardinality: number, _cardinalityNext: number
  ) => {
    const { initialized, index, cardinality, cardinalityNext } = await poolOracle.getPoolObservation(pool);
    expect(initialized).to.be.eq(_initialized);
    expect(index).to.be.eq(_index);
    expect(cardinality).to.be.eq(_cardinality);
    expect(cardinalityNext).to.be.eq(_cardinalityNext);
  }

  const verifyObservationAt = async (
    pool: string, _index: number,
    _blockTimestamp: number, _tickCumulative: BN, _initialized: boolean
  ) => {
    const { blockTimestamp, tickCumulative, initialized } = await poolOracle.getObservationAt(pool, _index);
    expect(blockTimestamp).to.be.eq(_blockTimestamp);
    expect(tickCumulative).to.be.eq(_tickCumulative);
    expect(initialized).to.be.eq(_initialized);
  }

  describe('#rescueFunds', async () => {
    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
    });

    it('rescue tokens', async () => {
      let amount = BN.from(100);
      await tokenA.transfer(poolOracle.address, amount);

      expect(await tokenA.balanceOf(poolOracle.address)).to.be.eq(amount);
      let owner = await poolOracle.owner();

      let balanceOwner = await tokenA.balanceOf(owner);
      let withdrawAmount = BN.from(10);

      await expect(poolOracle.connect(admin).rescueFund(tokenA.address, withdrawAmount))
        .to.be.emit(poolOracle, 'OwnerWithdrew')
        .withArgs(owner, tokenA.address, withdrawAmount);

      expect(await tokenA.balanceOf(owner)).to.be.eq(balanceOwner.add(withdrawAmount));
      expect(await tokenA.balanceOf(poolOracle.address)).to.be.eq(amount.sub(withdrawAmount));
    });

    it('revert not owner', async () => {
      let amount = BN.from(10);
      await tokenA.transfer(poolOracle.address, amount);

      await expect(poolOracle.connect(user).rescueFund(tokenA.address, amount))
        .to.be.reverted;
    });
  });

  describe('#initalize', async () => {
    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      poolOracle = await PoolOracleContract.deploy();
      await poolOracle.initialize();
      snapshotId = await snapshot();
    });

    it('correct default data after initialized', async () => {
      let times = [10, 20, 300];
      for (let i = 0; i < times.length; i++) {
        await poolOracle.connect(user).initializeOracle(times[i]);
        await verifyStoredObservation(user.address, true, 0, 1, 1);
        await verifyObservationAt(user.address, 0, times[i], BN.from(0), true);
      }
    });
  });

  describe('#increaseObservationCardinalityNext', async () => {
    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      poolOracle = await PoolOracleContract.deploy();
      await poolOracle.initialize();
      snapshotId = await snapshot();
    });

    it('revert current = 0, not initialized yet', async () => {
      // not initialized yet
      await verifyStoredObservation(admin.address, false, 0, 0, 0);
      await expect(poolOracle.connect(admin).increaseObservationCardinalityNext(admin.address, 1))
        .to.be.revertedWith('I');
    });

    it('nothing happens when next <= current', async () => {
      let initTime = 10;
      await poolOracle.connect(user).initializeOracle(initTime);
      let observation = await poolOracle.getPoolObservation(user.address);
      // current == next
      await expect(poolOracle.increaseObservationCardinalityNext(user.address, 1))
        .to.not.emit(poolOracle, 'IncreaseObservationCardinalityNext');
      await verifyStoredObservation(
        user.address, observation[0], observation[1], observation[2], observation[3]
      );
      // current > next
      await expect(poolOracle.increaseObservationCardinalityNext(user.address, 0))
        .to.not.emit(poolOracle, 'IncreaseObservationCardinalityNext');
      await verifyStoredObservation(
        user.address, observation[0], observation[1], observation[2], observation[3]
      );
    });

    it('verify block timestamp increases', async () => {
      let initTime = 5;
      await poolOracle.connect(user).initializeOracle(initTime);
      let times = [10, 15, 20, 30];
      let ticks = [5, 10, -10, -20];
      for (let i = 0; i < times.length; i++) {
        await poolOracle.connect(user).write(times[i], ticks[i], defaultLiquidity); // ignore liquidity
      }

      let poolObservation = await poolOracle.getPoolObservation(user.address);
      let cardinalityNext = poolObservation.cardinalityNext;
      let cardinalityNextNew = cardinalityNext + 10;
      let observations = []
      for(let i = cardinalityNext; i < cardinalityNextNew; i++) {
        let data = await poolOracle.getObservationAt(user.address, i);
        observations.push(data)
      }
      // check event should be emitted correctly
      await expect(poolOracle.increaseObservationCardinalityNext(user.address, cardinalityNextNew))
        .to.be.emit(poolOracle, 'IncreaseObservationCardinalityNext')
        .withArgs(user.address, cardinalityNext, cardinalityNextNew);

      for(let i = cardinalityNext; i < cardinalityNextNew; i++) {
        let oldData = observations[i - cardinalityNext];
        // verify that block timestamp is set to 1
        await verifyObservationAt(
          user.address, i, 1, oldData.tickCumulative, oldData.initialized
        );
      }

      // verify the cardinalityNext is updated
      await verifyStoredObservation(
        user.address,
        poolObservation.initialized,
        poolObservation.index,
        poolObservation.cardinality,
        cardinalityNextNew
      );
    });
  });

  describe('#write & writeNewEntry', async () => {
    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      poolOracle = await PoolOracleContract.deploy();
      await poolOracle.initialize();
      snapshotId = await snapshot();
    });

    it('write to index with same timestamp, no updates observation, updates pool observation', async () => {
      // write an entry to the observations
      let blockTimestamp = 1000;
      let tick = 10;
      await poolOracle.connect(user).initializeOracle(blockTimestamp);
      let poolObs = await poolOracle.getPoolObservation(user.address);
      let obsData0 = await poolOracle.getObservationAt(user.address, 0);
      // check entry at 0, ignore liquidity
      await poolOracle.connect(user).writeNewEntry(
        poolObs.index,
        blockTimestamp, tick, defaultLiquidity,
        poolObs.cardinality,
        poolObs.cardinalityNext
      );
      await verifyStoredObservation(
        user.address, true,
        poolObs.index, poolObs.cardinality, poolObs.cardinalityNext
      );
      await verifyObservationAt(
        user.address, 0, obsData0.blockTimestamp,
        obsData0.tickCumulative, obsData0.initialized
      );

      // increase blocktime by 10
      await poolOracle.connect(user).writeNewEntry(
        poolObs.index,
        blockTimestamp + 10, tick, defaultLiquidity,
        poolObs.cardinality,
        poolObs.cardinalityNext
      );
      await verifyObservationAt(
        user.address, 0, obsData0.blockTimestamp + 10,
        obsData0.tickCumulative.add(tick * 10), obsData0.initialized
      );

      // pool data of index and cardinality should change, cardinalityNext unchanges
      await poolOracle.connect(user).writeNewEntry(
        2, 0, tick, defaultLiquidity, 10, 11
      );
      await verifyStoredObservation(user.address, true, 2, 10, poolObs.cardinalityNext);
    });

    it('write with cardinalityUpdated = cardinality', async () => {
      // init at block timestamp = 1000
      let blockTimestamp = 1000;
      let tick = 10;
      let tickCumulative = BN.from(0);
      await poolOracle.connect(user).initializeOracle(blockTimestamp);

      await verifyStoredObservation(user.address, true, 0, 1, 1);
      await verifyObservationAt(user.address, 0, blockTimestamp, tickCumulative, true);

      // write update to index 0, no change in index and cardinality
      let timeIncrease = 10;
      blockTimestamp += timeIncrease;
      await poolOracle.connect(user).writeNewEntry(0, blockTimestamp, tick, defaultLiquidity, 1, 1);
      await verifyStoredObservation(user.address, true, 0, 1, 1);
      tickCumulative = tickCumulative.add(tick * timeIncrease);
      // increase block time by timeIncrease, tickCumulative increase by tick * timeIncrease
      await verifyObservationAt(user.address, 0, blockTimestamp, tickCumulative, true);

      timeIncrease = 100;
      tick = -10;
      // write update with index 0, cardinality > 1
      await poolOracle.connect(user).writeNewEntry(0, blockTimestamp + timeIncrease, tick, defaultLiquidity, 3, 3);
      // update pool observation cardinality and index, advance index by 1
      await verifyStoredObservation(user.address, true, 1, 3, 1);
      await verifyObservationAt(user.address, 0, blockTimestamp, tickCumulative, true);
      tickCumulative = tickCumulative.add(BN.from(timeIncrease * tick));
      // for index 1, time and tick increased
      await verifyObservationAt(user.address, 1, blockTimestamp + timeIncrease, tickCumulative, true);

      // update pool observation index and cardinality, index back to 0
      let obsData2 = await poolOracle.getObservationAt(user.address, 2);
      blockTimestamp = 2000;
      tick = 20;
      await poolOracle.connect(user).writeNewEntry(2, blockTimestamp, tick, defaultLiquidity, 3, 3);
      // index falls back to 0, where the rest are the same
      await verifyStoredObservation(user.address, true, 0, 3, 1);
      await verifyObservationAt(user.address, 2, obsData2.blockTimestamp, obsData2.tickCumulative, obsData2.initialized);
      // index 0 is reset to new value
      await verifyObservationAt(
        user.address, 0, blockTimestamp,
        obsData2.tickCumulative.add(BN.from((blockTimestamp - obsData2.blockTimestamp) * tick)),
        true
      );
    });

    it('write with cardinalityUpdated = cardinalityNext', async () => {
      // init at block timestamp = 1000
      let blockTimestamp = 1000;
      let tick = 10;
      let tickCumulative = BN.from(0);
      await poolOracle.connect(user).initializeOracle(blockTimestamp);

      await verifyStoredObservation(user.address, true, 0, 1, 1);
      await verifyObservationAt(user.address, 0, blockTimestamp, tickCumulative, true);

      // current data (index, cardinality, cardinalityNext) = (0, 1, 1)
      let timeIncrease = 10;

      await poolOracle.connect(user).writeNewEntry(0, blockTimestamp + timeIncrease, tick, defaultLiquidity, 1, 2);
      // cardinality should be updated to the next = 2, index increases by 1
      // cardinalityNext should be unchanged as we don't update it in the function
      await verifyStoredObservation(user.address, true, 1, 2, 1);
      // no change in index 0
      await verifyObservationAt(user.address, 0, blockTimestamp, tickCumulative, true);
      blockTimestamp += timeIncrease;
      tickCumulative = tickCumulative.add(BN.from(tick * timeIncrease));
      await verifyObservationAt(user.address, 1, blockTimestamp, tickCumulative, true);

      // advance cardinalityNext to 5
      await poolOracle.increaseObservationCardinalityNext(user.address, 5);
      await verifyStoredObservation(user.address, true, 1, 2, 5);
      // block timestamps cardinalityNextOld (1) to cardinalityNextNew (5) are set to 1
      await verifyObservationAt(user.address, 1, 1, tickCumulative, true);
      for(let i = 2; i < 5; i++) {
        // not yet initialized, but block timestamps are all 1
        await verifyObservationAt(user.address, i, 1, BN.from(0), false);
      }

      blockTimestamp = 1; // reset block timestamp to 1, for index 1
      // write new entry, since index = cardinality - 1 and cardinalityNext > cardinality
      // cardinality => cardinalityNext = 5, index => index + 1 = 2
      timeIncrease = 200;
      tick = -2;
      await poolOracle.connect(user).write(blockTimestamp + timeIncrease, tick, defaultLiquidity);
      await verifyStoredObservation(user.address, true, 2, 5, 5);
      // unchange for index 1
      await verifyObservationAt(user.address, 1, blockTimestamp, tickCumulative, true);
      // update for index 2
      blockTimestamp += timeIncrease;
      tickCumulative = tickCumulative.add(BN.from(timeIncrease * tick));
      await verifyObservationAt(user.address, 2, blockTimestamp, tickCumulative, true);

      // write an entry until index = cardinality - 1 = 4
      for(let i = 3; i <= 4; i++) {
        timeIncrease = 20 * i;
        tick = i * 10 - 36;
        await poolOracle.connect(user).write(blockTimestamp + timeIncrease, tick, defaultLiquidity);
        // index is advanced by 1
        await verifyStoredObservation(user.address, true, i, 5, 5);
        // data of last index is the same
        await verifyObservationAt(user.address, i - 1, blockTimestamp, tickCumulative, true);
        // data of the new index is written
        blockTimestamp += timeIncrease;
        tickCumulative = tickCumulative.add(BN.from(timeIncrease * tick));
        await verifyObservationAt(user.address, i, blockTimestamp, tickCumulative, true);
      }

      // now index = cardinality - 1, cardinality = cardinalityNext
      timeIncrease = 20;
      tick = 100;
      await poolOracle.connect(user).write(blockTimestamp + timeIncrease, tick, defaultLiquidity);
      // index is reset to 0
      await verifyStoredObservation(user.address, true, 0, 5, 5);
      // data of the last index (4) is the same
      await verifyObservationAt(user.address, 4, blockTimestamp, tickCumulative, true);
      // data of the index 0 is written
      blockTimestamp += timeIncrease;
        tickCumulative = tickCumulative.add(BN.from(timeIncrease * tick));
      await verifyObservationAt(user.address, 0, blockTimestamp, tickCumulative, true);
    });
  });
});
