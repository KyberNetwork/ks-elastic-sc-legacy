import {
  MockProAMMFactory__factory,
  ProAMMFactory__factory,
  ReinvestmentTokenMaster__factory,
  ProAMMFactory,
  ProAMMPool,
  MockProAMMFactory,
  MockToken,
  ProAMMPool__factory,
  MockProAMMCallbacks2
} from '../../typechain';
import {ethers} from 'hardhat';
import {BigNumberish, BigNumber as BN} from 'ethers';
import {getNearestSpacedTickAtPrice} from './utils';
import {PRECISION} from './helper';

export async function deployMockFactory (admin: any): Promise<MockProAMMFactory> {
  const ReinvestmentMaster = (await ethers.getContractFactory(
    'ReinvestmentTokenMaster'
  )) as ReinvestmentTokenMaster__factory;
  const reinvestmentMaster = await ReinvestmentMaster.deploy();

  const ProAMMFactoryContract = (await ethers.getContractFactory('MockProAMMFactory')) as MockProAMMFactory__factory;
  return await ProAMMFactoryContract.connect(admin).deploy(reinvestmentMaster.address);
}

export async function deployFactory (admin: any): Promise<ProAMMFactory> {
  const ReinvestmentMaster = (await ethers.getContractFactory(
    'ReinvestmentTokenMaster'
  )) as ReinvestmentTokenMaster__factory;
  const reinvestmentMaster = await ReinvestmentMaster.deploy();

  const ProAMMFactoryContract = (await ethers.getContractFactory('ProAMMFactory')) as ProAMMFactory__factory;
  return await ProAMMFactoryContract.connect(admin).deploy(reinvestmentMaster.address);
}

export async function createPool (
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
export async function setupPoolWithLiquidity (
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
  let tickSpacing = await pool.tickSpacing();

  const nearestTickToPrice = (await getNearestSpacedTickAtPrice(initialPrice, tickSpacing)).toNumber();

  await mockCallback.mint(
    pool.address,
    recipient,
    nearestTickToPrice - 20 * tickSpacing,
    nearestTickToPrice + 20 * tickSpacing,
    PRECISION.div(10)
  );
  return [pool, nearestTickToPrice];
}
