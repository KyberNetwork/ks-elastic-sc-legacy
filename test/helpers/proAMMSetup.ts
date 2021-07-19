import {
  ProAMMFactory,
  ProAMMFactory__factory,
  ReinvestmentTokenMaster,
  ReinvestmentTokenMaster__factory,
  ProAMMPool,
  ProAMMPool__factory,
} from '../../typechain';
import {ZERO_ADDRESS} from './helper';

let Factory: ProAMMFactory__factory;
let ReinvestmentMaster: ReinvestmentTokenMaster__factory;
let PoolMaster: ProAMMPool__factory;
let factory: ProAMMFactory;

export async function deployFactory(
  ethers: any,
  admin: any,
  reinvestmentMasterAddress: any,
  poolMasterAddress: any
) {
  Factory = (await ethers.getContractFactory('ProAMMFactory')) as ProAMMFactory__factory;
  if (reinvestmentMasterAddress == ZERO_ADDRESS) {
    let reinvestmentMaster = await deployReinvestmentTokenMaster(ethers);
    reinvestmentMasterAddress = reinvestmentMaster.address;
  }
  if (poolMasterAddress == ZERO_ADDRESS) {
    let poolMaster = await deployProAMMPoolMaster(ethers);
    poolMasterAddress = poolMaster.address;
  }
  return await Factory.connect(admin).deploy(reinvestmentMasterAddress, poolMasterAddress);
}

export async function deployReinvestmentTokenMaster(ethers: any) {
  ReinvestmentMaster = (await ethers.getContractFactory(
    'ReinvestmentTokenMaster'
  )) as ReinvestmentTokenMaster__factory;
  return await ReinvestmentMaster.deploy();
}

export async function deployProAMMPoolMaster(ethers: any) {
  PoolMaster = (await ethers.getContractFactory('ProAMMPool')) as ProAMMPool__factory;
  return await PoolMaster.deploy();
}
