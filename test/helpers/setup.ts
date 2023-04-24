import {
  MockFactory__factory,
  Factory__factory,
  Factory,
  Pool,
  MockFactory,
  PoolOracle,
  PoolOracle__factory,
  MockToken,
  Pool__factory,
  MockCallbacks2,
  MockPool,
} from '../../typechain';
import {ethers} from 'hardhat';
import {BigNumberish, BigNumber as BN} from 'ethers';
import {getNearestSpacedTickAtPrice} from './utils';
import {PRECISION, MIN_TICK, MAX_INT, MAX_TICK, ZERO, FEE_UNITS} from './helper';

export async function deployMockFactory(admin: any, vestingPeriod: BigNumberish): Promise<[MockFactory, PoolOracle]> {
  const PoolOracleContract = (await ethers.getContractFactory('PoolOracle')) as PoolOracle__factory;
  const poolOracle = await PoolOracleContract.connect(admin).deploy();
  await poolOracle.initialize();
  const FactoryContract = (await ethers.getContractFactory('MockFactory')) as MockFactory__factory;
  let factory = await FactoryContract.connect(admin).deploy(vestingPeriod, poolOracle.address);
  return [factory, poolOracle];
}

export async function deployFactory(admin: any, vestingPeriod: BigNumberish): Promise<Factory> {
  const PoolOracleContract = (await ethers.getContractFactory('PoolOracle')) as PoolOracle__factory;
  const poolOracle = await PoolOracleContract.connect(admin).deploy();
  const FactoryContract = (await ethers.getContractFactory('Factory')) as Factory__factory;
  const factory = await FactoryContract.connect(admin).deploy(vestingPeriod, poolOracle.address);
  await factory.updateFeeConfiguration(admin.address, FEE_UNITS.div(10)); // 10% fee
  return factory;
}

export async function createPool(
  factory: Factory,
  tokenA: MockToken,
  tokenB: MockToken,
  feeUnits: BigNumberish
): Promise<Pool> {
  await factory.createPool(tokenA.address, tokenB.address, feeUnits);
  const addr = await factory.getPool(tokenA.address, tokenB.address, feeUnits);
  const PoolContract = (await ethers.getContractFactory('Pool')) as Pool__factory;
  return PoolContract.attach(addr);
}

/**
 * @returns [pool, nearestTickToPrice]
 */
export async function setupPoolWithLiquidity(
  factory: Factory,
  mockCallback: MockCallbacks2,
  recipient: string,
  tokenA: MockToken,
  tokenB: MockToken,
  feeUnits: BigNumberish,
  initialPrice: BN
): Promise<[Pool, number]> {
  const pool = await createPool(factory, tokenA, tokenB, feeUnits);
  await mockCallback.unlockPool(pool.address, initialPrice);
  let tickDistance = await pool.tickDistance();

  const nearestTickToPrice = (await getNearestSpacedTickAtPrice(initialPrice, tickDistance)).toNumber();

  await mockCallback.mint(
    pool.address,
    recipient,
    nearestTickToPrice - 20 * tickDistance,
    nearestTickToPrice + 20 * tickDistance,
    [MIN_TICK, MIN_TICK],
    PRECISION.div(10)
  );

  return [pool, nearestTickToPrice];
}

/**
 * @return lower nearest ticks to the tickLower and tickUpper
 */
export async function getTicksPrevious(
  pool: Pool | MockPool,
  tickLower: BigNumberish,
  tickUpper: BigNumberish
): Promise<[BN, BN]> {
  // fetch all initialized ticks
  let initializedTicks = [MIN_TICK];
  let currentTick = MIN_TICK;
  while (!currentTick.eq(MAX_TICK)) {
    let {next} = await pool.initializedTicks(currentTick);
    currentTick = BN.from(next);
    initializedTicks.push(currentTick);
  }
  let ticksPrevious: [BN, BN] = [ZERO, ZERO];
  for (let i = 0; i < initializedTicks.length - 1; i++) {
    if (initializedTicks[i + 1].gt(tickLower) && ticksPrevious[0].eq(ZERO)) {
      ticksPrevious[0] = initializedTicks[i];
    }
    if (initializedTicks[i + 1].gt(tickUpper) && ticksPrevious[1].eq(ZERO)) {
      ticksPrevious[1] = initializedTicks[i];
      break;
    }
  }
  return ticksPrevious;
}
