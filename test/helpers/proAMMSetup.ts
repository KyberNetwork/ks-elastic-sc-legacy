import {
  ProAMMFactory__factory,
  ReinvestmentTokenMaster__factory,
  ProAMMFactory,
  ProAMMPool,
  MockToken,
  ProAMMPool__factory
} from '../../typechain';
import {ethers} from 'hardhat';
import {BigNumberish} from 'ethers';

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
