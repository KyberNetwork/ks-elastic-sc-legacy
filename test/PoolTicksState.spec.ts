import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {ZERO, TWO_POW_96, BN, NEGATIVE_ONE, ZERO_ADDRESS, MAX_TICK, MIN_TICK} from './helpers/helper';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {
  MockPoolTicksState,
  MockPoolTicksStateFactory,
  MockPoolTicksStateFactory__factory,
  MockPoolTicksState__factory,
  PoolOracle,
  PoolOracle__factory
} from '../typechain';
import {BigNumberish} from '@ethersproject/bignumber';

const tickSpacing = 50;
let poolOracle: PoolOracle

async function assertTicksData(
  mockPoolTicksState: MockPoolTicksState,
  tick: BigNumberish,
  expectedLiquidityGross: BigNumberish,
  expectedLiquidityNet: BigNumberish,
  expectedFeeGrowthOutside: BigNumberish
) {
  const {liquidityGross, liquidityNet, feeGrowthOutside} = await mockPoolTicksState.ticks(tick);
  expect(liquidityGross).to.be.eq(expectedLiquidityGross);
  expect(liquidityNet).to.be.eq(expectedLiquidityNet);
  expect(feeGrowthOutside).to.be.eq(expectedFeeGrowthOutside);
}

async function assertLinkedListData(
  mockPoolTicksState: MockPoolTicksState,
  tick: BigNumberish,
  expectedPrevTick: BigNumberish,
  expectedNextTick: BigNumberish
) {
  const {previous, next} = await mockPoolTicksState.initializedTicks(tick);
  expect(previous).to.be.eq(expectedPrevTick);
  expect(next).to.be.eq(expectedNextTick);
}

async function verifyInitializedData(mockPoolTicksState: MockPoolTicksState, initializedTicks: BigNumberish[]) {
  for (let i = 0; i < initializedTicks.length; i++) {
    await assertLinkedListData(
      mockPoolTicksState,
      initializedTicks[i],
      i == 0 ? initializedTicks[i] : initializedTicks[i - 1],
      i == initializedTicks.length - 1 ? initializedTicks[i] : initializedTicks[i + 1]
    );
  }
}

describe('PoolTicksState', () => {
  let mockPoolTicksState: MockPoolTicksState;
  let factory: MockPoolTicksStateFactory;
  let [user1, user2] = waffle.provider.getWallets();

  beforeEach('setup', async () => {
    const PoolOracleContract = (await ethers.getContractFactory('PoolOracle')) as PoolOracle__factory;
    poolOracle = await PoolOracleContract.deploy();
    const MockPoolTicksStateFactoryContract = (await ethers.getContractFactory(
      'MockPoolTicksStateFactory'
    )) as MockPoolTicksStateFactory__factory;
    factory = await MockPoolTicksStateFactoryContract.deploy();

    // deploy mock poolTicksState
    await factory.create(poolOracle.address, ZERO_ADDRESS, ZERO_ADDRESS, 5, tickSpacing);
    const MockPoolTicksStateContract = (await ethers.getContractFactory(
      'MockPoolTicksState'
    )) as MockPoolTicksState__factory;
    mockPoolTicksState = MockPoolTicksStateContract.attach(await factory.state());

    await mockPoolTicksState.externalInitPoolStorage(TWO_POW_96, ZERO);
  });

  describe('#externalUpdatePosition', async () => {
    it('should return 0 values for empty position', async () => {
      let {liquidity, feeGrowthInsideLast} = await mockPoolTicksState.getPositions(user1.address, 50, 1000);
      expect(liquidity).to.be.eq(ZERO);
      expect(feeGrowthInsideLast).to.be.eq(ZERO);
    });

    describe('add liquidity', async () => {
      it('updatePosition should change ticks data', async () => {
        const feeGrowth1 = BN.from(20);
        const liquidity1 = BN.from(10000);
        // update position from 100 to 200 with currentTick = 150
        await mockPoolTicksState.externalUpdatePosition(
          {
            liquidityDelta: liquidity1,
            owner: user1.address,
            tickLower: 100,
            tickUpper: 200,
            tickLowerPrevious: MIN_TICK,
            tickUpperPrevious: MIN_TICK,
            isAddLiquidity: true,
          },
          150,
          {feeGrowth: feeGrowth1, secondsPerLiquidity: ZERO}
        );

        let {liquidity, feeGrowthInsideLast} = await mockPoolTicksState.getPositions(user1.address, 100, 200);
        expect(liquidity).to.be.eq(liquidity1);
        expect(feeGrowthInsideLast).to.be.eq(ZERO);

        await assertTicksData(mockPoolTicksState, 100, liquidity1, liquidity1, feeGrowth1);
        await assertTicksData(mockPoolTicksState, 200, liquidity1, liquidity1.mul(NEGATIVE_ONE), ZERO);

        const liquidity2 = BN.from(5000);
        // add liqudity from -100 to 100
        await mockPoolTicksState.externalUpdatePosition(
          {
            liquidityDelta: liquidity2,
            owner: user2.address,
            tickLower: -100,
            tickUpper: 100,
            tickLowerPrevious: MIN_TICK,
            tickUpperPrevious: MIN_TICK,
            isAddLiquidity: true,
          },
          150,
          {feeGrowth: feeGrowth1, secondsPerLiquidity: ZERO}
        );
        await assertTicksData(
          mockPoolTicksState,
          100,
          liquidity1.add(liquidity2),
          liquidity1.sub(liquidity2),
          feeGrowth1
        );
        await assertTicksData(mockPoolTicksState, -100, liquidity2, liquidity2, feeGrowth1);
      });
    });
  });

  describe('#crossToTick', async () => {
    const feeGrowth1 = BN.from(20);
    const feeGrowth2 = BN.from(70);
    const liquidity1 = BN.from(10000);
    const liquidity2 = BN.from(5000);

    beforeEach('add liquidity', async () => {
      // update position from 100 to 200 with currentTick = 150
      await mockPoolTicksState.externalUpdatePosition(
        {
          liquidityDelta: liquidity1,
          owner: user1.address,
          tickLower: 100,
          tickUpper: 200,
          tickLowerPrevious: MIN_TICK,
          tickUpperPrevious: MIN_TICK,
          isAddLiquidity: true,
        },
        150,
        {feeGrowth: ZERO, secondsPerLiquidity: ZERO}
      );
      await mockPoolTicksState.externalUpdatePosition(
        {
          liquidityDelta: liquidity2,
          owner: user2.address,
          tickLower: -100,
          tickUpper: 100,
          tickLowerPrevious: MIN_TICK,
          tickUpperPrevious: MIN_TICK,
          isAddLiquidity: true,
        },
        150,
        {feeGrowth: ZERO, secondsPerLiquidity: ZERO}
      );
    });

    it('cross upper tick and then down tick should update feeGrownthOutside', async () => {
      await mockPoolTicksState.externalUpdateLiquidityAndCrossTick(200, liquidity1.add(1), feeGrowth1, ZERO, true);

      let {feeGrowthOutside} = await mockPoolTicksState.ticks(200);
      expect(feeGrowthOutside).to.be.eq(feeGrowth1);

      await mockPoolTicksState.externalUpdateLiquidityAndCrossTick(200, 1, feeGrowth2, ZERO, false);
      ({feeGrowthOutside} = await mockPoolTicksState.ticks(200));
      expect(feeGrowthOutside).to.be.eq(feeGrowth2.sub(feeGrowth1));
    });

    it('liquidityNet should be return correctly', async () => {
      let {newNextTick, newLiquidity} = await mockPoolTicksState.callStatic.externalUpdateLiquidityAndCrossTick(
        200,
        liquidity1.add(1),
        feeGrowth1,
        ZERO,
        true
      );
      expect(newLiquidity).to.be.eq(1);
      expect(newNextTick).to.be.eq(MAX_TICK);

      ({newNextTick, newLiquidity} = await mockPoolTicksState.callStatic.externalUpdateLiquidityAndCrossTick(
        200,
        1,
        feeGrowth2,
        ZERO,
        false
      ));
      expect(newLiquidity).to.be.eq(liquidity1.add(1));
      expect(newNextTick).to.be.eq(100);
    });
  });

  describe('initializedTickList should be update', async () => {
    it('should init value as MIN and MAX tick', async () => {
      await verifyInitializedData(mockPoolTicksState, [MIN_TICK, MAX_TICK]);

      expect((await mockPoolTicksState.getPoolState()).nearestCurrentTick).to.be.eq(MIN_TICK);
    });

    it('add liquidity', async () => {
      await mockPoolTicksState.externalUpdatePosition(
        {
          owner: user1.address,
          tickLower: -10,
          tickUpper: 20,
          tickLowerPrevious: MIN_TICK,
          tickUpperPrevious: MIN_TICK,
          liquidityDelta: 10,
          isAddLiquidity: true,
        },
        0,
        {
          feeGrowth: 0,
          secondsPerLiquidity: 0,
        }
      );

      await verifyInitializedData(mockPoolTicksState, [MIN_TICK, -10, 20, MAX_TICK]);
      expect((await mockPoolTicksState.getPoolState()).nearestCurrentTick).to.be.eq(-10);

      await mockPoolTicksState.externalUpdatePosition(
        {
          owner: user1.address,
          tickLower: 10,
          tickUpper: 20,
          tickLowerPrevious: MIN_TICK,
          tickUpperPrevious: MIN_TICK,
          liquidityDelta: 10,
          isAddLiquidity: true,
        },
        0,
        {
          feeGrowth: 0,
          secondsPerLiquidity: 0,
        }
      );

      await verifyInitializedData(mockPoolTicksState, [MIN_TICK, -10, 10, 20, MAX_TICK]);
      expect((await mockPoolTicksState.getPoolState()).nearestCurrentTick).to.be.eq(-10);
    });

    it('remove liquidity', async () => {
      // add liquidity in range [-10, 20] and [10, 20]
      await mockPoolTicksState.externalUpdatePosition(
        {
          owner: user1.address,
          tickLower: -10,
          tickUpper: 20,
          tickLowerPrevious: MIN_TICK,
          tickUpperPrevious: MIN_TICK,
          liquidityDelta: 10,
          isAddLiquidity: true,
        },
        0,
        {
          feeGrowth: 0,
          secondsPerLiquidity: 0,
        }
      );
      await mockPoolTicksState.externalUpdatePosition(
        {
          owner: user1.address,
          tickLower: 10,
          tickUpper: 20,
          tickLowerPrevious: MIN_TICK,
          tickUpperPrevious: MIN_TICK,
          liquidityDelta: 10,
          isAddLiquidity: true,
        },
        0,
        {
          feeGrowth: 0,
          secondsPerLiquidity: 0,
        }
      );
      // remove liquidity at [-10, 20]
      await mockPoolTicksState.externalUpdatePosition(
        {
          owner: user1.address,
          tickLower: -10,
          tickUpper: 20,
          tickLowerPrevious: MIN_TICK,
          tickUpperPrevious: MIN_TICK,
          liquidityDelta: 10,
          isAddLiquidity: false,
        },
        0,
        {
          feeGrowth: 0,
          secondsPerLiquidity: 0,
        }
      );
      await assertLinkedListData(mockPoolTicksState, -10, 0, 0); // empty data
      await verifyInitializedData(mockPoolTicksState, [MIN_TICK, 10, 20, MAX_TICK]);

      expect((await mockPoolTicksState.getPoolState()).nearestCurrentTick).to.be.eq(MIN_TICK);
    });
  });

  it('special case when add liquidity to MIN_TICK - MAX_TICK', async () => {
    // deploy mock poolTicksState
    await factory.create(poolOracle.address, ZERO_ADDRESS, ZERO_ADDRESS, 5, 1);
    const MockPoolTicksStateContract = (await ethers.getContractFactory(
      'MockPoolTicksState'
    )) as MockPoolTicksState__factory;
    mockPoolTicksState = MockPoolTicksStateContract.attach(await factory.state());
    await mockPoolTicksState.externalInitPoolStorage(TWO_POW_96, ZERO);

    await mockPoolTicksState.externalUpdatePosition(
      {
        owner: user1.address,
        tickLower: MIN_TICK,
        tickUpper: 100,
        tickLowerPrevious: MIN_TICK,
        tickUpperPrevious: MIN_TICK,
        liquidityDelta: 10,
        isAddLiquidity: true,
      },
      0,
      {
        feeGrowth: 0,
        secondsPerLiquidity: 0,
      }
    );
    await verifyInitializedData(mockPoolTicksState, [MIN_TICK, 100, MAX_TICK]);

    await mockPoolTicksState.externalUpdatePosition(
      {
        owner: user1.address,
        tickLower: -100,
        tickUpper: MAX_TICK,
        tickLowerPrevious: MIN_TICK,
        tickUpperPrevious: MIN_TICK,
        liquidityDelta: 10,
        isAddLiquidity: true,
      },
      0,
      {
        feeGrowth: 0,
        secondsPerLiquidity: 0,
      }
    );
    await verifyInitializedData(mockPoolTicksState, [MIN_TICK, -100, 100, MAX_TICK]);
  });

  describe('#updateTickList', async () => {
    beforeEach('setup data', async () => {
      await factory.create(poolOracle.address, ZERO_ADDRESS, ZERO_ADDRESS, 5, 1);
      const MockPoolTicksStateContract = (await ethers.getContractFactory(
        'MockPoolTicksState'
      )) as MockPoolTicksState__factory;
      mockPoolTicksState = MockPoolTicksStateContract.attach(await factory.state());
      await mockPoolTicksState.externalInitPoolStorage(TWO_POW_96, ZERO);
    });

    it('insert - at min/max ticks, nothing updates', async () => {
      await verifyInitializedData(mockPoolTicksState, [MIN_TICK, MAX_TICK]);
      await mockPoolTicksState.externalUpdateTickList(MIN_TICK, MIN_TICK, 100, true);
      await verifyInitializedData(mockPoolTicksState, [MIN_TICK, MAX_TICK]);
      await mockPoolTicksState.externalUpdateTickList(MAX_TICK, MIN_TICK, 100, true);
      await verifyInitializedData(mockPoolTicksState, [MIN_TICK, MAX_TICK]);
    });

    it('insert - tick previous has been removed or non-existent', async () => {
      await expect(mockPoolTicksState.externalUpdateTickList(20, 10, 100, true)).to.be.revertedWith(
        'previous tick has been removed'
      );

      // add, then remove
      await mockPoolTicksState.externalUpdateTickList(10, MIN_TICK, 100, true);
      await mockPoolTicksState.externalUpdateTickList(10, 10, 100, false);

      await expect(mockPoolTicksState.externalUpdateTickList(12, 10, 100, true)).to.be.revertedWith(
        'previous tick has been removed'
      );
    });

    it('insert - revert previous tick is higher than the new tick', async () => {
      await mockPoolTicksState.externalUpdateTickList(200, MIN_TICK, 100, true);
      await expect(mockPoolTicksState.externalUpdateTickList(10, 200, 200, true)).to.be.revertedWith(
        'invalid lower value'
      );
    });

    it('insert - revert previous tick is too far from the new tick', async () => {
      let maxTravel = 10;
      let initializedTicks = [MIN_TICK, MAX_TICK];
      for (let i = 1; i <= maxTravel + 1; i++) {
        mockPoolTicksState.externalUpdateTickList(i * 10, MIN_TICK, 200, true);
        initializedTicks.splice(i, 0, BN.from(i * 10));
      }
      await verifyInitializedData(mockPoolTicksState, initializedTicks);
      await expect(mockPoolTicksState.externalUpdateTickList(200, MIN_TICK, 200, true)).to.be.revertedWith(
        'invalid lower value'
      );
    });

    it('insert - change nearest tick', async () => {
      let {currentTick} = await mockPoolTicksState.getPoolState();
      await mockPoolTicksState.externalUpdateTickList(currentTick - 100, MIN_TICK, currentTick, true);
      let poolData = await mockPoolTicksState.getPoolState();
      expect(poolData.nearestCurrentTick).to.be.eq(currentTick - 100);
      await mockPoolTicksState.externalUpdateTickList(currentTick - 10, MIN_TICK, currentTick, true);
      poolData = await mockPoolTicksState.getPoolState();
      expect(poolData.nearestCurrentTick).to.be.eq(currentTick - 10);
      // update new value which is lower than nearest, data doesn't change
      let previousData = poolData.nearestCurrentTick;
      await mockPoolTicksState.externalUpdateTickList(currentTick - 200, MIN_TICK, currentTick, true);
      poolData = await mockPoolTicksState.getPoolState();
      expect(poolData.nearestCurrentTick).to.be.eq(previousData);
      await mockPoolTicksState.externalUpdateTickList(currentTick + 100, MIN_TICK, currentTick, true);
      poolData = await mockPoolTicksState.getPoolState();
      expect(poolData.nearestCurrentTick).to.be.eq(previousData);
    });

    it('insert - correct data updates', async () => {
      await mockPoolTicksState.externalUpdateTickList(10, MIN_TICK, 100, true);
      await verifyInitializedData(mockPoolTicksState, [MIN_TICK, 10, MAX_TICK]);
      await mockPoolTicksState.externalUpdateTickList(50, MIN_TICK, 100, true);
      await verifyInitializedData(mockPoolTicksState, [MIN_TICK, 10, 50, MAX_TICK]);
      await mockPoolTicksState.externalUpdateTickList(100, 50, 100, true);
      await verifyInitializedData(mockPoolTicksState, [MIN_TICK, 10, 50, 100, MAX_TICK]);
    });

    it('remove - revert non-existent value', async () => {
      await expect(mockPoolTicksState.externalUpdateTickList(10, MIN_TICK, 100, false)).to.be.revertedWith(
        'remove non-existent value'
      );
    });

    it('remove - revert non-existent value', async () => {
      await expect(mockPoolTicksState.externalUpdateTickList(10, MIN_TICK, 100, false)).to.be.revertedWith(
        'remove non-existent value'
      );
    });

    it('remove - at min/max tick, nothing changes', async () => {
      await mockPoolTicksState.externalUpdateTickList(MIN_TICK, MIN_TICK, 100, false);
      await verifyInitializedData(mockPoolTicksState, [MIN_TICK, MAX_TICK]);
      await mockPoolTicksState.externalUpdateTickList(MAX_TICK, MIN_TICK, 100, false);
      await verifyInitializedData(mockPoolTicksState, [MIN_TICK, MAX_TICK]);
    });

    it('remove - not update nearest tick', async () => {
      let {nearestCurrentTick} = await mockPoolTicksState.getPoolState();
      await mockPoolTicksState.externalUpdateTickList(nearestCurrentTick + 10, MIN_TICK, 100, true);
      await verifyInitializedData(mockPoolTicksState, [MIN_TICK, nearestCurrentTick + 10, MAX_TICK]);
      await mockPoolTicksState.externalUpdateTickList(nearestCurrentTick + 100, MIN_TICK, 100, true);
      await verifyInitializedData(mockPoolTicksState, [
        MIN_TICK,
        nearestCurrentTick + 10,
        nearestCurrentTick + 100,
        MAX_TICK,
      ]);
      await mockPoolTicksState.externalUpdateTickList(nearestCurrentTick + 100, MIN_TICK, 100, false);
      await verifyInitializedData(mockPoolTicksState, [MIN_TICK, nearestCurrentTick + 10, MAX_TICK]);
      await mockPoolTicksState.externalUpdateTickList(nearestCurrentTick + 10, MIN_TICK, 100, false);
      await verifyInitializedData(mockPoolTicksState, [MIN_TICK, MAX_TICK]);
    });

    it('remove - should update nearest tick', async () => {
      let {currentTick} = await mockPoolTicksState.getPoolState();
      await mockPoolTicksState.externalUpdateTickList(currentTick - 100, MIN_TICK, currentTick, true);
      let poolData = await mockPoolTicksState.getPoolState();
      expect(poolData.nearestCurrentTick).to.be.eq(currentTick - 100);
      await mockPoolTicksState.externalUpdateTickList(currentTick - 50, MIN_TICK, currentTick, true);
      await mockPoolTicksState.externalUpdateTickList(currentTick - 150, MIN_TICK, currentTick, true);
      poolData = await mockPoolTicksState.getPoolState();
      expect(poolData.nearestCurrentTick).to.be.eq(currentTick - 50);
      // remove the nearest value, nearest current tick should be changed to the previous
      await mockPoolTicksState.externalUpdateTickList(currentTick - 50, MIN_TICK, currentTick, false);
      poolData = await mockPoolTicksState.getPoolState();
      expect(poolData.nearestCurrentTick).to.be.eq(currentTick - 100);
      await mockPoolTicksState.externalUpdateTickList(currentTick - 100, MIN_TICK, currentTick, false);
      poolData = await mockPoolTicksState.getPoolState();
      expect(poolData.nearestCurrentTick).to.be.eq(currentTick - 150);
      await mockPoolTicksState.externalUpdateTickList(currentTick - 150, MIN_TICK, currentTick, false);
      poolData = await mockPoolTicksState.getPoolState();
      expect(poolData.nearestCurrentTick).to.be.eq(MIN_TICK);
    });
  });
});
