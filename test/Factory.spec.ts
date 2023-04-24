import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {BN, PRECISION, ZERO_ADDRESS, BPS_PLUS_ONE, ZERO, ONE, BPS, FEE_UNITS, FEE_UNITS_PLUS_ONE} from './helpers/helper';
import chai from 'chai';
const {solidity, loadFixture} = waffle;
chai.use(solidity);

import {
  Factory, Factory__factory,
  MockToken, MockToken__factory,
  PoolOracle, PoolOracle__factory,
} from '../typechain';
import {getCreate2Address} from './helpers/utils';

let Token: MockToken__factory;
let poolOracle: PoolOracle;
let factory: Factory;
let tokenA: MockToken;
let tokenB: MockToken;
let swapFeeUnits: number;
let tickDistance: number;
let vestingPeriod = 100;

describe('Factory', () => {
  const [operator, admin, configMaster, nftManager, nftManager2] = waffle.provider.getWallets();

  async function fixture() {
    Token = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    tokenA = await Token.deploy('USDC', 'USDC', BN.from(1000).mul(PRECISION));
    tokenB = await Token.deploy('DAI', 'DAI', BN.from(1000).mul(PRECISION));

    const PoolOracleContract = (await ethers.getContractFactory('PoolOracle')) as PoolOracle__factory;
    poolOracle = (await PoolOracleContract.connect(admin).deploy());
    const FactoryContract = (await ethers.getContractFactory('Factory')) as Factory__factory;
    return await FactoryContract.connect(admin).deploy(vestingPeriod, poolOracle.address);
  }

  beforeEach('load fixture', async () => {
    factory = await loadFixture(fixture);
    swapFeeUnits = 40;
    tickDistance = 8;
  });

  it('should return the contract creation code storage addresses', async () => {
    const {contractA, contractB} = await factory.getCreationCodeContracts();
    const codeA = await ethers.provider.getCode(contractA);
    const codeB = await ethers.provider.getCode(contractB);
    let factoryBytecode = await factory.getCreationCode();
    expect(codeA.concat(codeB.slice(2))).to.eql(factoryBytecode);
  });

  it('should have initialized with the expected settings', async () => {
    expect(await factory.configMaster()).to.eql(admin.address);
    expect(await factory.poolOracle()).to.eql(poolOracle.address);
    expect(await factory.feeAmountTickDistance(8)).to.eql(1);
    expect(await factory.feeAmountTickDistance(10)).to.eql(1);
    expect(await factory.feeAmountTickDistance(40)).to.eql(8);
    expect(await factory.feeAmountTickDistance(300)).to.eql(60);
    expect(await factory.feeAmountTickDistance(1000)).to.eql(200);
    let result = await factory.feeConfiguration();
    expect(result._feeTo).to.eql(ZERO_ADDRESS);
    expect(result._governmentFeeUnits).to.eql(0);
  });

  it('should be able to deploy a pool', async () => {
    await expect(factory.createPool(tokenA.address, tokenB.address, swapFeeUnits)).to.emit(factory, 'PoolCreated');

    swapFeeUnits = 300;

    await expect(factory.createPool(tokenA.address, tokenB.address, swapFeeUnits)).to.emit(factory, 'PoolCreated');
  });

  describe('#createPool', async () => {
    it('should revert for identical tokens', async () => {
      await expect(factory.createPool(tokenA.address, tokenA.address, swapFeeUnits)).to.be.revertedWith(
        'identical tokens'
      );
    });

    it('should revert if either token is null', async () => {
      await expect(factory.createPool(tokenA.address, ZERO_ADDRESS, swapFeeUnits)).to.be.revertedWith('null address');
      await expect(factory.createPool(ZERO_ADDRESS, tokenA.address, swapFeeUnits)).to.be.revertedWith('null address');
    });

    it('should revert for invalid swapFeeUnits', async () => {
      await expect(factory.createPool(tokenA.address, tokenB.address, ZERO)).to.be.revertedWith('invalid fee');
    });

    it('should revert for invalid swapFeeUnits', async () => {
      await expect(factory.createPool(tokenA.address, tokenB.address, ZERO)).to.be.revertedWith('invalid fee');
    });

    it('should revert for existing pool', async () => {
      await factory.createPool(tokenA.address, tokenB.address, swapFeeUnits);
      await expect(factory.createPool(tokenA.address, tokenB.address, swapFeeUnits)).to.be.revertedWith('pool exists');
      await expect(factory.createPool(tokenB.address, tokenA.address, swapFeeUnits)).to.be.revertedWith('pool exists');
    });

    it('should return the same pool address regardless of token order', async () => {
      await factory.createPool(tokenA.address, tokenB.address, swapFeeUnits);
      let poolAddressOne = await factory.getPool(tokenA.address, tokenB.address, swapFeeUnits);
      let poolAddressTwo = await factory.getPool(tokenA.address, tokenB.address, swapFeeUnits);
      expect(poolAddressOne).to.be.eq(poolAddressTwo);
      expect(poolAddressOne).to.not.be.eq(ZERO_ADDRESS);
    });

    it('should update correctly the parameters', async () => {
      let swapFee = 300;
      await factory.createPool(tokenA.address, tokenB.address, swapFee);
      let token0 = tokenA.address < tokenB.address ? tokenA.address : tokenB.address;
      let token1 = token0 == tokenA.address ? tokenB.address : tokenA.address;
      let parameters = await factory.parameters();
      expect(parameters.factory).to.be.eql(factory.address);
      expect(parameters.poolOracle).to.be.eql(await factory.poolOracle());
      expect(parameters.token0).to.be.eql(token0);
      expect(parameters.token1).to.be.eql(token1);
      expect(parameters.swapFeeUnits).to.be.eql(swapFee);
      expect(parameters.tickDistance).to.be.eql(60);
    });

    it('should return different pool addresses for different swap fee units', async () => {
      await factory.createPool(tokenA.address, tokenB.address, swapFeeUnits);
      let poolAddressOne = await factory.getPool(tokenA.address, tokenB.address, swapFeeUnits);
      swapFeeUnits = 300;
      await factory.createPool(tokenA.address, tokenB.address, swapFeeUnits);
      let poolAddressTwo = await factory.getPool(tokenA.address, tokenB.address, swapFeeUnits);
      expect(poolAddressOne).to.be.not.be.eql(poolAddressTwo);
    });

    it('creates the predictable address', async () => {
      await factory.createPool(tokenA.address, tokenB.address, swapFeeUnits);
      let poolAddress = await factory.getPool(tokenA.address, tokenB.address, swapFeeUnits);
      let factoryBytecode = await factory.getCreationCode();
      expect(poolAddress).to.eql(
        getCreate2Address(factory.address, [tokenA.address, tokenB.address, swapFeeUnits], factoryBytecode)
      );
    });
  });

  describe('#updateVestingPeriod', async () => {
    it('should revert if msg.sender != configMaster', async () => {
      await expect(factory.connect(operator).updateVestingPeriod(vestingPeriod)).to.be.revertedWith('forbidden');
    });

    it('should set new vesting period, and emit event', async () => {
      let newVestingPeriod = 1000;
      await expect(factory.connect(admin).updateVestingPeriod(newVestingPeriod))
        .to.emit(factory, 'VestingPeriodUpdated')
        .withArgs(newVestingPeriod);
      expect(await factory.vestingPeriod()).to.be.eq(newVestingPeriod);
    });

    it('should be able to update vesting period to 0', async () => {
      await factory.connect(admin).updateVestingPeriod(ZERO);
      expect(await factory.vestingPeriod()).to.be.eq(0);
    });
  });

  describe('whitelisting feature', async () => {
    it('should revert if msg.sender != configMaster', async () => {
      await expect(factory.connect(operator).enableWhitelist()).to.be.revertedWith('forbidden');
      await expect(factory.connect(operator).disableWhitelist()).to.be.revertedWith('forbidden');
      await expect(factory.connect(operator).addNFTManager(nftManager.address)).to.be.revertedWith('forbidden');
      await expect(factory.connect(operator).removeNFTManager(nftManager.address)).to.be.revertedWith('forbidden');
    });

    it('should be able to update whitelist feature and emit event', async () => {
      await expect(factory.connect(admin).enableWhitelist()).to.emit(factory, 'WhitelistEnabled');
      await expect(factory.connect(admin).disableWhitelist()).to.emit(factory, 'WhitelistDisabled');
    });

    it('should have isWhitelistedNFTManager return true for all addresses if whitelisting feature is disabled', async () => {
      await factory.connect(admin).disableWhitelist();
      expect(await factory.isWhitelistedNFTManager(nftManager.address)).to.be.true;
      expect(await factory.isWhitelistedNFTManager(admin.address)).to.be.true;
      expect(await factory.isWhitelistedNFTManager(operator.address)).to.be.true;
    });

    it('should have isWhitelistedNFTManager return true for only whitelisted addresses if whitelisting feature is enabled', async () => {
      await factory.connect(admin).enableWhitelist();
      expect(await factory.isWhitelistedNFTManager(nftManager.address)).to.be.false;
      expect(await factory.isWhitelistedNFTManager(admin.address)).to.be.false;
      expect(await factory.isWhitelistedNFTManager(operator.address)).to.be.false;
    });

    it('should be able to add NFT manager and emit event', async () => {
      await expect(factory.connect(admin).addNFTManager(nftManager.address))
        .to.emit(factory, 'NFTManagerAdded')
        .withArgs(nftManager.address, true);
      expect(await factory.isWhitelistedNFTManager(nftManager.address)).to.be.true;
      expect(await factory.getWhitelistedNFTManagers()).to.be.eql([nftManager.address]);
    });

    it('should not change state if NFTManager has already been added', async () => {
      await factory.connect(admin).addNFTManager(nftManager.address);
      await expect(factory.connect(admin).addNFTManager(nftManager.address))
        .to.emit(factory, 'NFTManagerAdded')
        .withArgs(nftManager.address, false);
      expect(await factory.isWhitelistedNFTManager(nftManager.address)).to.be.true;
      expect(await factory.getWhitelistedNFTManagers()).to.be.eql([nftManager.address]);
    });

    it('should be able to add more than 1 NFTManager', async () => {
      await factory.connect(admin).addNFTManager(nftManager.address);
      await factory.connect(admin).addNFTManager(nftManager2.address);
      expect(await factory.getWhitelistedNFTManagers()).to.be.eql([nftManager.address, nftManager2.address]);
    });

    it('should be able to remove an added NFTManager and emit event', async () => {
      await factory.connect(admin).addNFTManager(nftManager.address);
      await expect(factory.connect(admin).removeNFTManager(nftManager.address))
        .to.emit(factory, 'NFTManagerRemoved')
        .withArgs(nftManager.address, true);
      expect(await factory.isWhitelistedNFTManager(nftManager.address)).to.be.false;
      expect(await factory.getWhitelistedNFTManagers()).to.be.eql([]);
    });

    it('should not change state if NFTManager has already been removed', async () => {
      await factory.connect(admin).addNFTManager(nftManager.address);
      await factory.connect(admin).removeNFTManager(nftManager.address);
      await expect(factory.connect(admin).removeNFTManager(nftManager.address))
        .to.emit(factory, 'NFTManagerRemoved')
        .withArgs(nftManager.address, false);
      expect(await factory.isWhitelistedNFTManager(nftManager.address)).to.be.false;
      expect(await factory.getWhitelistedNFTManagers()).to.be.eql([]);
    });

    it('should be able to remove multiple NFTManagers', async () => {
      await factory.connect(admin).addNFTManager(nftManager.address);
      await factory.connect(admin).addNFTManager(nftManager2.address);
      await factory.connect(admin).removeNFTManager(nftManager.address);
      await factory.connect(admin).removeNFTManager(nftManager2.address);
      expect(await factory.isWhitelistedNFTManager(nftManager.address)).to.be.false;
      expect(await factory.isWhitelistedNFTManager(nftManager2.address)).to.be.false;
      expect(await factory.getWhitelistedNFTManagers()).to.be.eql([]);
    });
  });

  describe('#updateConfigMaster', async () => {
    it('should revert if msg.sender != configMaster', async () => {
      await expect(factory.connect(operator).updateConfigMaster(configMaster.address)).to.be.revertedWith('forbidden');
    });

    it('should correctly update configMaster and emit event', async () => {
      await expect(factory.connect(admin).updateConfigMaster(configMaster.address))
        .to.emit(factory, 'ConfigMasterUpdated')
        .withArgs(admin.address, configMaster.address);

      expect(await factory.configMaster()).to.eql(configMaster.address);
      // admin should not be able to update configurations
      await expect(factory.connect(admin).updateConfigMaster(configMaster.address)).to.be.revertedWith('forbidden');
      await expect(factory.connect(admin).enableSwapFee(swapFeeUnits, tickDistance)).to.be.revertedWith('forbidden');
      await expect(factory.connect(admin).updateFeeConfiguration(admin.address, swapFeeUnits)).to.be.revertedWith(
        'forbidden'
      );
      // configMaster should be able to update
      swapFeeUnits = 200;
      tickDistance = 100;
      await factory.connect(configMaster).enableSwapFee(swapFeeUnits, tickDistance);
      await factory.connect(configMaster).updateFeeConfiguration(admin.address, swapFeeUnits);
    });
  });

  describe('#enableSwapFee', async () => {
    it('should revert enableSwapFee if msg.sender != configMaster', async () => {
      await expect(factory.connect(operator).enableSwapFee(2, 20)).to.be.revertedWith('forbidden');
    });

    it('should revert for swapFeeUnits > FEE_UNITS', async () => {
      await expect(factory.connect(admin).enableSwapFee(FEE_UNITS_PLUS_ONE, 20)).to.be.revertedWith('invalid fee');
    });

    it('should revert for invalid tickDistance', async () => {
      await expect(factory.connect(admin).enableSwapFee(swapFeeUnits, ZERO)).to.be.revertedWith('invalid tickDistance');
      await expect(factory.connect(admin).enableSwapFee(swapFeeUnits, 16385)).to.be.revertedWith('invalid tickDistance');
      await expect(factory.connect(admin).enableSwapFee(swapFeeUnits, -1)).to.be.revertedWith('invalid tickDistance');
    });

    it('should revert for existing tickDistance', async () => {
      await expect(factory.connect(admin).enableSwapFee(swapFeeUnits, BPS_PLUS_ONE)).to.be.revertedWith(
        'existing tickDistance'
      );
      await expect(factory.connect(admin).enableSwapFee(300, BPS_PLUS_ONE)).to.be.revertedWith('existing tickDistance');
    });

    it('should set new tickDistance and emit event', async () => {
      swapFeeUnits = 100;
      tickDistance = 30;
      await expect(factory.connect(admin).enableSwapFee(swapFeeUnits, tickDistance))
        .to.emit(factory, 'SwapFeeEnabled')
        .withArgs(swapFeeUnits, tickDistance);
      expect(await factory.feeAmountTickDistance(swapFeeUnits)).to.be.eq(tickDistance);
    });

    it('should be able to utilise new tickDistance for pool creation', async () => {
      swapFeeUnits = 100;
      tickDistance = 30;
      await factory.connect(admin).enableSwapFee(swapFeeUnits, tickDistance);
      await factory.createPool(tokenA.address, tokenB.address, swapFeeUnits);
      expect(await factory.getPool(tokenA.address, tokenB.address, swapFeeUnits)).to.not.be.eql(tickDistance);
    });
  });

  describe('#updateFeeConfiguration', async () => {
    it('should revert if msg.sender != configMaster', async () => {
      await expect(factory.connect(operator).updateFeeConfiguration(admin.address, ONE)).to.be.revertedWith(
        'forbidden'
      );
    });

    it('should revert for invalid governmentFeeUnits', async () => {
      await expect(factory.connect(admin).updateFeeConfiguration(admin.address, 20001)).to.be.revertedWith(
        'invalid fee'
        );
      await expect(factory.connect(admin).updateFeeConfiguration(admin.address, FEE_UNITS)).to.be.revertedWith(
        'invalid fee'
      );
    });

    it('should set new feeTo and governmentFeeUnits, and emit event', async () => {
      let governmentFeeUnits = 500;
      await expect(factory.connect(admin).updateFeeConfiguration(admin.address, governmentFeeUnits))
        .to.emit(factory, 'FeeConfigurationUpdated')
        .withArgs(admin.address, governmentFeeUnits);
      let result = await factory.feeConfiguration();
      expect(result._feeTo).to.be.eq(admin.address);
      expect(result._governmentFeeUnits).to.be.eq(governmentFeeUnits);

      // change configMaster
      await factory.connect(admin).updateConfigMaster(operator.address);
      governmentFeeUnits = 200;
      // operator updates fee config
      await factory.connect(operator).updateFeeConfiguration(operator.address, governmentFeeUnits);
      result = await factory.feeConfiguration();
      expect(result._feeTo).to.be.eq(operator.address);
      expect(result._governmentFeeUnits).to.be.eq(governmentFeeUnits);
    });

    it('should be unable to update governmentFeeUnits to 0 if feeTo is not null', async () => {
      await expect(factory.connect(admin).updateFeeConfiguration(admin.address, ZERO)).to.be.revertedWith(
        'bad config'
      );
    });

    it('should be unable to update to null feeTo if governmentFeeUnits is not 0', async () => {
      await expect(factory.connect(admin).updateFeeConfiguration(ZERO_ADDRESS, 5)).to.be.revertedWith('bad config');
    });

    it('should be able to update governmentFeeUnits to 0 with null address', async () => {
      await factory.connect(admin).updateFeeConfiguration(ZERO_ADDRESS, ZERO);
      let result = await factory.feeConfiguration();
      expect(result._feeTo).to.be.eq(ZERO_ADDRESS);
      expect(result._governmentFeeUnits).to.be.eq(0);
    });

    it('should be able to update governmentFeeUnits to the max value (2000)', async () => {
      let governmentFeeUnits = 20000;
      await factory.connect(admin).updateFeeConfiguration(operator.address, governmentFeeUnits);
      let result = await factory.feeConfiguration();
      expect(result._feeTo).to.be.eq(operator.address);
      expect(result._governmentFeeUnits).to.be.eq(governmentFeeUnits);
    });
  });
});
