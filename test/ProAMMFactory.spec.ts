import {artifacts, ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {Wallet} from 'ethers';
import {BN, PRECISION, ZERO_ADDRESS} from './helpers/helper';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {
  ProAMMFactory,
  ProAMMFactory__factory,
  ReinvestmentTokenMaster,
  ReinvestmentTokenMaster__factory,
  MockToken,
  MockToken__factory
} from '../typechain';

let Factory: ProAMMFactory__factory;
let ReinvestmentTokenMain: ReinvestmentTokenMaster__factory;
let Token: MockToken__factory;
let admin;
let operator;
let feeToSetter;
let factory: ProAMMFactory;
let reinvestmentTokenMain: ReinvestmentTokenMaster;
let token0: MockToken;
let token1: MockToken;

describe('ProAMMFactory', () => {
  const [operator, admin, feeToSetter] = waffle.provider.getWallets();

  before('setup', async () => {
    Factory = (await ethers.getContractFactory('ProAMMFactory')) as ProAMMFactory__factory;
    ReinvestmentTokenMain = (await ethers.getContractFactory('ReinvestmentTokenMaster')) as ReinvestmentTokenMaster__factory;
    reinvestmentTokenMain = await ReinvestmentTokenMain.deploy();
    Token = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    token0 = await Token.deploy('USDC', 'USDC', BN.from(1000).mul(PRECISION));
    token1 = await Token.deploy('DAI', 'DAI', BN.from(1000).mul(PRECISION));
  });

  describe('#update data', async () => {
    beforeEach('init contract', async () => {
      factory = await Factory.connect(admin).deploy(reinvestmentTokenMain.address);
    });

    it('should have initialized with the expected settings', async() => {
      expect(await factory.feeToSetter()).to.eql(admin.address);
      expect(await factory.reinvestmentTokenMaster()).to.eql(reinvestmentTokenMain.address);
      expect(await factory.feeAmountTickSpacing(5)).to.eql(10);
      expect(await factory.feeAmountTickSpacing(30)).to.eql(60);
      let data = await factory.getFeeConfiguration();
      expect(data._feeTo).to.eql(ZERO_ADDRESS);
      expect(data._governmentFeeBps).to.eql(0);
    });

    it('should be able to deploy a pool', async() => {
      let pool = await factory.createPool(token0.address, token1.address, 5);
      console.log(pool);
    });
  });
});
