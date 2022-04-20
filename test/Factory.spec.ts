import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {BN, PRECISION, ZERO_ADDRESS, BPS_PLUS_ONE, ZERO, ONE, BPS} from './helpers/helper';
import chai from 'chai';
const {solidity, loadFixture} = waffle;
chai.use(solidity);

import {Factory, MockToken, MockToken__factory, Factory__factory} from '../typechain';
import {getCreate2Address} from './helpers/utils';

let Token: MockToken__factory;
let factory: Factory;
let tokenA: MockToken;
let tokenB: MockToken;
let swapFeeBps: number;
let tickDistance: number;
let vestingPeriod = 100;

describe('Factory', () => {
  const [operator, admin, configMaster, nftManager, nftManager2] = waffle.provider.getWallets();

  async function fixture() {
    Token = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    tokenA = await Token.deploy('USDC', 'USDC', BN.from(1000).mul(PRECISION));
    tokenB = await Token.deploy('DAI', 'DAI', BN.from(1000).mul(PRECISION));

    const FactoryContract = (await ethers.getContractFactory('Factory')) as Factory__factory;
    return await FactoryContract.connect(admin).deploy(vestingPeriod);
  }

  beforeEach('load fixture', async () => {
    factory = await loadFixture(fixture);
    swapFeeBps = 5;
    tickDistance = 10;
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
    expect(await factory.feeAmountTickDistance(1)).to.eql(1);
    expect(await factory.feeAmountTickDistance(5)).to.eql(10);
    expect(await factory.feeAmountTickDistance(30)).to.eql(60);
    expect(await factory.feeAmountTickDistance(100)).to.eql(200);
    let result = await factory.feeConfiguration();
    expect(result._feeTo).to.eql(ZERO_ADDRESS);
    expect(result._governmentFeeBps).to.eql(0);
  });

  it('should be able to deploy a pool', async () => {
    await expect(factory.createPool(tokenA.address, tokenB.address, swapFeeBps)).to.emit(factory, 'PoolCreated');

    swapFeeBps = 30;

    await expect(factory.createPool(tokenA.address, tokenB.address, swapFeeBps)).to.emit(factory, 'PoolCreated');
  });

  describe('#createPool', async () => {
    it('should revert for identical tokens', async () => {
      await expect(factory.createPool(tokenA.address, tokenA.address, swapFeeBps)).to.be.revertedWith(
        'identical tokens'
      );
    });

    it('should revert if either token is null', async () => {
      await expect(factory.createPool(tokenA.address, ZERO_ADDRESS, swapFeeBps)).to.be.revertedWith('null address');
      await expect(factory.createPool(ZERO_ADDRESS, tokenA.address, swapFeeBps)).to.be.revertedWith('null address');
    });

    it('should revert for invalid swapFeeBps', async () => {
      await expect(factory.createPool(tokenA.address, tokenB.address, ZERO)).to.be.revertedWith('invalid fee');
    });

    it('should revert for invalid swapFeeBps', async () => {
      await expect(factory.createPool(tokenA.address, tokenB.address, ZERO)).to.be.revertedWith('invalid fee');
    });

    it('should revert for existing pool', async () => {
      await factory.createPool(tokenA.address, tokenB.address, swapFeeBps);
      await expect(factory.createPool(tokenA.address, tokenB.address, swapFeeBps)).to.be.revertedWith('pool exists');
      await expect(factory.createPool(tokenB.address, tokenA.address, swapFeeBps)).to.be.revertedWith('pool exists');
    });

    it('should return the same pool address regardless of token order', async () => {
      await factory.createPool(tokenA.address, tokenB.address, swapFeeBps);
      let poolAddressOne = await factory.getPool(tokenA.address, tokenB.address, swapFeeBps);
      let poolAddressTwo = await factory.getPool(tokenA.address, tokenB.address, swapFeeBps);
      expect(poolAddressOne).to.be.eql(poolAddressTwo);
      expect(poolAddressOne).to.not.be.eql(ZERO_ADDRESS);
    });

    it('should return different pool addresses for different swap fee bps', async () => {
      await factory.createPool(tokenA.address, tokenB.address, swapFeeBps);
      let poolAddressOne = await factory.getPool(tokenA.address, tokenB.address, swapFeeBps);
      swapFeeBps = 30;
      await factory.createPool(tokenA.address, tokenB.address, swapFeeBps);
      let poolAddressTwo = await factory.getPool(tokenA.address, tokenB.address, swapFeeBps);
      expect(poolAddressOne).to.be.not.be.eql(poolAddressTwo);
    });

    it('creates the predictable address', async () => {
      await factory.createPool(tokenA.address, tokenB.address, swapFeeBps);
      let poolAddress = await factory.getPool(tokenA.address, tokenB.address, swapFeeBps);
      let factoryBytecode = await factory.getCreationCode();
      expect(poolAddress).to.eql(
        getCreate2Address(factory.address, [tokenA.address, tokenB.address, swapFeeBps], factoryBytecode)
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
      expect(await factory.vestingPeriod()).to.be.eql(newVestingPeriod);
    });

    it('should be able to update vesting period to 0', async () => {
      await factory.connect(admin).updateVestingPeriod(ZERO);
      expect(await factory.vestingPeriod()).to.be.eql(0);
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
      await expect(factory.connect(admin).enableSwapFee(swapFeeBps, tickDistance)).to.be.revertedWith('forbidden');
      await expect(factory.connect(admin).updateFeeConfiguration(admin.address, swapFeeBps)).to.be.revertedWith(
        'forbidden'
      );
      // configMaster should be able to update
      swapFeeBps = 20;
      tickDistance = 100;
      await factory.connect(configMaster).enableSwapFee(swapFeeBps, tickDistance);
      await factory.connect(configMaster).updateFeeConfiguration(admin.address, swapFeeBps);
    });
  });

  describe('#enableSwapFee', async () => {
    it('should revert enableSwapFee if msg.sender != configMaster', async () => {
      await expect(factory.connect(operator).enableSwapFee(2, 20)).to.be.revertedWith('forbidden');
    });

    it('should revert for swapFeeBps > BPS', async () => {
      await expect(factory.connect(admin).enableSwapFee(BPS_PLUS_ONE, 20)).to.be.revertedWith('invalid fee');
    });

    it('should revert for invalid tickDistance', async () => {
      await expect(factory.connect(admin).enableSwapFee(swapFeeBps, ZERO)).to.be.revertedWith('invalid tickDistance');
      await expect(factory.connect(admin).enableSwapFee(swapFeeBps, 16385)).to.be.revertedWith('invalid tickDistance');
      await expect(factory.connect(admin).enableSwapFee(swapFeeBps, -1)).to.be.revertedWith('invalid tickDistance');
    });

    it('should revert for existing tickDistance', async () => {
      await expect(factory.connect(admin).enableSwapFee(swapFeeBps, BPS_PLUS_ONE)).to.be.revertedWith(
        'existing tickDistance'
      );
      await expect(factory.connect(admin).enableSwapFee(30, BPS_PLUS_ONE)).to.be.revertedWith('existing tickDistance');
    });

    it('should set new tickDistance and emit event', async () => {
      swapFeeBps = 10;
      tickDistance = 30;
      await expect(factory.connect(admin).enableSwapFee(swapFeeBps, tickDistance))
        .to.emit(factory, 'SwapFeeEnabled')
        .withArgs(swapFeeBps, tickDistance);
      expect(await factory.feeAmountTickDistance(swapFeeBps)).to.be.eql(tickDistance);
    });

    it('should be able to utilise new tickDistance for pool creation', async () => {
      swapFeeBps = 10;
      tickDistance = 30;
      await factory.connect(admin).enableSwapFee(swapFeeBps, tickDistance);
      await factory.createPool(tokenA.address, tokenB.address, swapFeeBps);
      expect(await factory.getPool(tokenA.address, tokenB.address, swapFeeBps)).to.not.be.eql(tickDistance);
    });
  });

  describe('#updateFeeConfiguration', async () => {
    it('should revert if msg.sender != configMaster', async () => {
      await expect(factory.connect(operator).updateFeeConfiguration(admin.address, ONE)).to.be.revertedWith(
        'forbidden'
      );
    });

    it('should revert for invalid governmentFeeBps', async () => {
      await expect(factory.connect(admin).updateFeeConfiguration(admin.address, 2001)).to.be.revertedWith(
        'invalid fee'
      );
      await expect(factory.connect(admin).updateFeeConfiguration(admin.address, BPS)).to.be.revertedWith(
        'invalid fee'
      );
    });

    it('should set new feeTo and governmentFeeBps, and emit event', async () => {
      let governmentFeeBps = 50;
      await expect(factory.connect(admin).updateFeeConfiguration(admin.address, governmentFeeBps))
        .to.emit(factory, 'FeeConfigurationUpdated')
        .withArgs(admin.address, governmentFeeBps);
      let result = await factory.feeConfiguration();
      expect(result._feeTo).to.be.eql(admin.address);
      expect(result._governmentFeeBps).to.be.eql(governmentFeeBps);

      // change configMaster
      await factory.connect(admin).updateConfigMaster(operator.address);
      governmentFeeBps = 20;
      // operator updates fee config
      await factory.connect(operator).updateFeeConfiguration(operator.address, governmentFeeBps);
      result = await factory.feeConfiguration();
      expect(result._feeTo).to.be.eql(operator.address);
      expect(result._governmentFeeBps).to.be.eql(governmentFeeBps);
    });

    it('should be unable to update governmentFeeBps to 0 if feeTo is not null', async () => {
      await expect(factory.connect(admin).updateFeeConfiguration(admin.address, ZERO)).to.be.revertedWith(
        'bad config'
      );
    });

    it('should be unable to update to null feeTo if governmentFeeBps is not 0', async () => {
      await expect(factory.connect(admin).updateFeeConfiguration(ZERO_ADDRESS, 5)).to.be.revertedWith('bad config');
    });

    it('should be able to update governmentFeeBps to 0 with null address', async () => {
      await factory.connect(admin).updateFeeConfiguration(ZERO_ADDRESS, ZERO);
      let result = await factory.feeConfiguration();
      expect(result._feeTo).to.be.eql(ZERO_ADDRESS);
      expect(result._governmentFeeBps).to.be.eql(0);
    });

    it('should be able to update governmentFeeBps to the max value (2000)', async () => {
      let governmentFeeBps = 2000;
      await factory.connect(admin).updateFeeConfiguration(operator.address, governmentFeeBps);
      let result = await factory.feeConfiguration();
      expect(result._feeTo).to.be.eql(operator.address);
      expect(result._governmentFeeBps).to.be.eql(governmentFeeBps);
    });
  });
});
