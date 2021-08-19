import {
  ProAMMFactory__factory,
  ReinvestmentTokenMaster__factory,
  ProAMMPool__factory,
  ProAMMFactory,
} from '../../typechain';
import {ethers} from 'hardhat';

export async function deployFactory(admin: any): Promise<ProAMMFactory> {
  const ReinvestmentMaster = (await ethers.getContractFactory(
    'ReinvestmentTokenMaster'
  )) as ReinvestmentTokenMaster__factory;
  const reinvestmentMaster = await ReinvestmentMaster.deploy();

  const ProAMMPoolContract = (await ethers.getContractFactory('ProAMMPool')) as ProAMMPool__factory;
  const poolMaster = await ProAMMPoolContract.deploy();

  const ProAMMFactoryContract = (await ethers.getContractFactory('ProAMMFactory')) as ProAMMFactory__factory;
  return await ProAMMFactoryContract.connect(admin).deploy(reinvestmentMaster.address, poolMaster.address);
}
