import {
  MockProAMMFactory__factory,
  ProAMMFactory__factory,
  ProAMMFactory,
  ProAMMPool,
  MockProAMMFactory,
  MockToken,
  ProAMMPool__factory,
  MockProAMMCallbacks2,
} from '../../typechain';
import {ethers} from 'hardhat';
import {BigNumberish, BigNumber as BN} from 'ethers';
import {getNearestSpacedTickAtPrice} from './utils';
import {PRECISION, MIN_TICK, MAX_INT, MAX_TICK} from './helper';

export async function deployMockFactory(admin: any, vestingPeriod: BigNumberish): Promise<MockProAMMFactory> {
  const ProAMMFactoryContract = (await ethers.getContractFactory('MockProAMMFactory')) as MockProAMMFactory__factory;
  return await ProAMMFactoryContract.connect(admin).deploy(vestingPeriod);
}

export async function deployFactory(admin: any, vestingPeriod: BigNumberish): Promise<ProAMMFactory> {
  const ProAMMFactoryContract = (await ethers.getContractFactory('ProAMMFactory')) as ProAMMFactory__factory;
  return await ProAMMFactoryContract.connect(admin).deploy(vestingPeriod);
}

export async function createPool(
  factory: ProAMMFactory,
  tokenA: MockToken,
  tokenB: MockToken,
  feeBps: BigNumberish
): Promise<ProAMMPool> {
  await factory.createPool(tokenA.address, tokenB.address, feeBps);
  const addr = await factory.getPool(tokenA.address, tokenB.address, feeBps);
  const ProAMMPoolContract = (await ethers.getContractFactory('ProAMMPool')) as ProAMMPool__factory;
  return ProAMMPoolContract.attach(addr);
}

/**
 * @returns [pool, nearestTickToPrice]
 */
export async function setupPoolWithLiquidity(
  factory: ProAMMFactory,
  mockCallback: MockProAMMCallbacks2,
  recipient: string,
  tokenA: MockToken,
  tokenB: MockToken,
  feeBps: BigNumberish,
  initialPrice: BN
): Promise<[ProAMMPool, number]> {
  const pool = await createPool(factory, tokenA, tokenB, feeBps);
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
  pool: ProAMMFactory,
  tickLower: BigNumberish,
  tickUpper: BigNumberish
): Promise<BigNumberish[]> {
  // fetch all initialized ticks
  let initializedTicks = [MIN_TICK];
  let currentTick = MIN_TICK;
  while (currentTick != MAX_TICK) {
    let {next} = await pool.initializedTicks(currentTick);
    currentTick = next;
    initializedTicks.push(currentTick);
  }
  let ticksPrevious = [];
  for (let i = 0; i < initializedTicks.length - 1; i++) {
    if (initializedTicks[i + 1] > tickLower && ticksPrevious.length == 0) {
      ticksPrevious.push(initializedTicks[i]);
    }
    if (initializedTicks[i + 1] > tickUpper && ticksPrevious.length == 1) {
      ticksPrevious.push(initializedTicks[i])
      break;
    }
  }
  return ticksPrevious;
}
