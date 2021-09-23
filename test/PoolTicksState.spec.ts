import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {
  ZERO,
  ONE,
  TWO,
  TWO_POW_96,
  PRECISION,
  MAX_INT_128,
  MAX_UINT,
  BN,
  NEGATIVE_ONE,
  ZERO_ADDRESS,
  MAX_TICK,
  MIN_TICK
} from './helpers/helper';
import chai from 'chai';
const {solidity, loadFixture} = waffle;
chai.use(solidity);

import {
  MockPoolTicksState,
  MockPoolTicksStateFactory__factory,
  MockPoolTicksState__factory,
  ReinvestmentTokenMaster__factory
} from '../typechain';
import exp from 'node:constants';
import {BigNumberish} from '@ethersproject/bignumber';

const tickSpacing = 50;
const maxTickPerLiquidity = 1000000;

async function assertTicksData (
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

async function assertLinkedListData (
  mockPoolTicksState: MockPoolTicksState,
  tick: BigNumberish,
  expectedPrevTick: BigNumberish,
  expectedNextTick: BigNumberish
) {
  const {previous, next} = await mockPoolTicksState.initializedTicks(tick);
  expect(previous).to.be.eq(expectedPrevTick);
  expect(next).to.be.eq(expectedNextTick);
}

describe('LiquidityMath', () => {
  let mockPoolTicksState: MockPoolTicksState;
  let [user1, user2] = waffle.provider.getWallets();

  beforeEach('setup', async () => {
    // deploy reinvestment master
    const ReinvestmentMaster = (await ethers.getContractFactory(
      'ReinvestmentTokenMaster'
    )) as ReinvestmentTokenMaster__factory;
    const reinvestmentMaster = await ReinvestmentMaster.deploy();
    const MockPoolTicksStateFactoryContract = (await ethers.getContractFactory(
      'MockPoolTicksStateFactory'
    )) as MockPoolTicksStateFactory__factory;
    let factory = await MockPoolTicksStateFactoryContract.deploy(reinvestmentMaster.address);

    // deploy mock poolTicksState
    await factory.create(ZERO_ADDRESS, ZERO_ADDRESS, 5, tickSpacing);
    const MockPoolTicksStateContract = (await ethers.getContractFactory(
      'MockPoolTicksState'
    )) as MockPoolTicksState__factory;
    mockPoolTicksState = MockPoolTicksStateContract.attach(await factory.state());

    await mockPoolTicksState.externalInitPoolStorage(TWO_POW_96, ZERO);
  });

  describe('#externalUpdatePosition', async () => {
    it('should return 0 values for empty position', async () => {
      let {liquidity, feeGrowthInsideLast} = await mockPoolTicksState.getPositions(user1.address, 50, 1000);
      expect(liquidity).to.be.eql(ZERO);
      expect(feeGrowthInsideLast).to.be.eql(ZERO);
    });

    describe('add liquidity', async () => {
      it('updatePosition should change ticks data', async () => {
        const feeGrowth1 = BN.from(20);
        const liquidity1 = BN.from(10000);
        // update position from 100 to 200 with currentTick = 150
        await mockPoolTicksState.externalUpdatePosition(
          {liquidityDelta: liquidity1, owner: user1.address, tickLower: 100, tickUpper: 200},
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
          {liquidityDelta: liquidity2, owner: user2.address, tickLower: -100, tickUpper: 100},
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
        {liquidityDelta: liquidity1, owner: user1.address, tickLower: 100, tickUpper: 200},
        150,
        {feeGrowth: ZERO, secondsPerLiquidity: ZERO}
      );
      await mockPoolTicksState.externalUpdatePosition(
        {liquidityDelta: liquidity2, owner: user2.address, tickLower: -100, tickUpper: 100},
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
      assertLinkedListData(mockPoolTicksState, MIN_TICK, MIN_TICK, MAX_TICK);
      assertLinkedListData(mockPoolTicksState, MAX_TICK, MIN_TICK, MAX_TICK);

      expect((await mockPoolTicksState.getPoolState())._nearestCurrentTick).to.be.eq(MIN_TICK);
    });

    it('add liquidity', async () => {
      await mockPoolTicksState.externalUpdatePosition(
        {owner: user1.address, tickLower: -10, tickUpper: 20, liquidityDelta: 10},
        0,
        {
          feeGrowth: 0,
          secondsPerLiquidity: 0
        }
      );

      assertLinkedListData(mockPoolTicksState, MIN_TICK, MIN_TICK, -10);
      assertLinkedListData(mockPoolTicksState, -10, MIN_TICK, 20);
      assertLinkedListData(mockPoolTicksState, 20, -10, MAX_TICK);
      assertLinkedListData(mockPoolTicksState, MAX_TICK, 20, MAX_TICK);

      expect((await mockPoolTicksState.getPoolState())._nearestCurrentTick).to.be.eq(-10);

      await mockPoolTicksState.externalUpdatePosition(
        {owner: user1.address, tickLower: 10, tickUpper: 20, liquidityDelta: 10},
        0,
        {
          feeGrowth: 0,
          secondsPerLiquidity: 0
        }
      );

      assertLinkedListData(mockPoolTicksState, -10, MIN_TICK, 10);
      assertLinkedListData(mockPoolTicksState, 10, -10, 20);
      assertLinkedListData(mockPoolTicksState, 20, 10, MAX_TICK);

      expect((await mockPoolTicksState.getPoolState())._nearestCurrentTick).to.be.eq(-10);
    });

    it('remove liquidity', async () => {
      // add liquidity in range [-10, 20] and [10, 20]
      await mockPoolTicksState.externalUpdatePosition(
        {owner: user1.address, tickLower: -10, tickUpper: 20, liquidityDelta: 10},
        0,
        {
          feeGrowth: 0,
          secondsPerLiquidity: 0
        }
      );
      await mockPoolTicksState.externalUpdatePosition(
        {owner: user1.address, tickLower: 10, tickUpper: 20, liquidityDelta: 10},
        0,
        {
          feeGrowth: 0,
          secondsPerLiquidity: 0
        }
      );
      // remove liquidity at [-10, 20]
      await mockPoolTicksState.externalUpdatePosition(
        {owner: user1.address, tickLower: -10, tickUpper: 20, liquidityDelta: -10},
        0,
        {
          feeGrowth: 0,
          secondsPerLiquidity: 0
        }
      );
      assertLinkedListData(mockPoolTicksState, -10, 0, 0); // empty data
      assertLinkedListData(mockPoolTicksState, 10, MIN_TICK, 20);
      assertLinkedListData(mockPoolTicksState, 20, 10, MAX_TICK);

      expect((await mockPoolTicksState.getPoolState())._nearestCurrentTick).to.be.eq(MIN_TICK);
    });
  });
});
