import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {BN, PRECISION, ZERO_ADDRESS, BPS_PLUS_ONE, ZERO, ONE, BPS} from './helpers/helper';
import chai from 'chai';
const {solidity, loadFixture} = waffle;
chai.use(solidity);

import {
  ProAMMFactory,
  ReinvestmentTokenMaster,
  MockToken,
  MockToken__factory,
  ReinvestmentTokenMaster__factory,
  ProAMMFactory__factory,
  ProAMMPool__factory
} from '../typechain';
import { getCreate2Address } from './helpers/utils';

let Token: MockToken__factory;
let factory: ProAMMFactory;
let reinvestmentMaster: ReinvestmentTokenMaster;
let tokenA: MockToken;
let tokenB: MockToken;
let swapFeeBps: number;
let tickSpacing: number;

describe('ProAMMFactory', () => {
  const [operator, admin, configMaster, nftManager, nftManager2] = waffle.provider.getWallets();

  async function fixture () {
    Token = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    tokenA = await Token.deploy('USDC', 'USDC', BN.from(1000).mul(PRECISION));
    tokenB = await Token.deploy('DAI', 'DAI', BN.from(1000).mul(PRECISION));
    const ReinvestmentMaster = (await ethers.getContractFactory(
      'ReinvestmentTokenMaster'
    )) as ReinvestmentTokenMaster__factory;
    reinvestmentMaster = await ReinvestmentMaster.deploy();

    const ProAMMFactoryContract = (await ethers.getContractFactory('ProAMMFactory')) as ProAMMFactory__factory;
    return await ProAMMFactoryContract.connect(admin).deploy(reinvestmentMaster.address);
  }

  beforeEach('load fixture', async () => {
    factory = await loadFixture(fixture);
    swapFeeBps = 5;
    tickSpacing = 10;
  });

  it('should have initialized with the expected settings', async () => {
    expect(await factory.configMaster()).to.eql(admin.address);
    expect(await factory.feeAmountTickSpacing(5)).to.eql(10);
    expect(await factory.feeAmountTickSpacing(30)).to.eql(60);
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
      await expect(factory.createPool(tokenA.address, tokenB.address, ONE)).to.be.revertedWith('invalid fee');
    });

    it('should revert for invalid swapFeeBps', async () => {
      await expect(factory.createPool(tokenA.address, tokenB.address, ONE)).to.be.revertedWith('invalid fee');
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
      const ProAMMPoolContract = (await ethers.getContractFactory('ProAMMPool')) as ProAMMPool__factory;
      expect(poolAddress).to.eql(
        getCreate2Address(factory.address, [tokenA.address, tokenB.address, swapFeeBps], ProAMMPoolContract.bytecode)
      );
      expect(await factory.getCreationCode()).to.eql(ProAMMPoolContract.bytecode);
    });
  });

  describe('whitelisting feature', async () => {
    it('should revert if msg.sender != configMaster', async () => {
      await expect(factory.connect(operator).disableWhitelist(true)).to.be.revertedWith('forbidden');
      await expect(factory.connect(operator).addNFTManager(nftManager.address)).to.be.revertedWith('forbidden');
      await expect(factory.connect(operator).removeNFTManager(nftManager.address)).to.be.revertedWith('forbidden');
    });

    it('should be able to update whitelist feature and emit event', async () => {
      await expect(factory.connect(admin).disableWhitelist(true))
        .to.emit(factory, 'WhitelistDisabled')
        .withArgs(true);
      await expect(factory.connect(admin).disableWhitelist(false))
        .to.emit(factory, 'WhitelistDisabled')
        .withArgs(false);
    });

    it('should have isWhitelistedNFTManager return true for all addresses if whitelisting feature is disabled', async () => {
      await factory.connect(admin).disableWhitelist(true);
      expect(await factory.isWhitelistedNFTManager(nftManager.address)).to.be.true;
      expect(await factory.isWhitelistedNFTManager(admin.address)).to.be.true;
      expect(await factory.isWhitelistedNFTManager(operator.address)).to.be.true;
    });

    it('should have isWhitelistedNFTManager return true for only whitelisted addresses if whitelisting feature is enabled', async () => {
      await factory.connect(admin).disableWhitelist(false);
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
      await expect(factory.connect(admin).enableSwapFee(swapFeeBps, tickSpacing)).to.be.revertedWith('forbidden');
      await expect(factory.connect(admin).updateFeeConfiguration(admin.address, swapFeeBps)).to.be.revertedWith(
        'forbidden'
      );
      // configMaster should be able to update
      swapFeeBps = 20;
      tickSpacing = 100;
      await factory.connect(configMaster).enableSwapFee(swapFeeBps, tickSpacing);
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

    it('should revert for invalid tickSpacing', async () => {
      await expect(factory.connect(admin).enableSwapFee(swapFeeBps, ZERO)).to.be.revertedWith('invalid tickSpacing');
      await expect(factory.connect(admin).enableSwapFee(swapFeeBps, 16385)).to.be.revertedWith(
        'invalid tickSpacing'
      );
      await expect(factory.connect(admin).enableSwapFee(swapFeeBps, -1)).to.be.revertedWith('invalid tickSpacing');
    });

    it('should revert for existing tickSpacing', async () => {
      await expect(factory.connect(admin).enableSwapFee(swapFeeBps, BPS_PLUS_ONE)).to.be.revertedWith(
        'existing tickSpacing'
      );
      await expect(factory.connect(admin).enableSwapFee(30, BPS_PLUS_ONE)).to.be.revertedWith(
        'existing tickSpacing'
      );
    });

    it('should set new tickSpacing and emit event', async () => {
      swapFeeBps = 10;
      tickSpacing = 30;
      await expect(factory.connect(admin).enableSwapFee(swapFeeBps, tickSpacing))
        .to.emit(factory, 'SwapFeeEnabled')
        .withArgs(swapFeeBps, tickSpacing);
      expect(await factory.feeAmountTickSpacing(swapFeeBps)).to.be.eql(tickSpacing);
    });

    it('should be able to utilise new tickSpacing for pool creation', async () => {
      swapFeeBps = 10;
      tickSpacing = 30;
      await factory.connect(admin).enableSwapFee(swapFeeBps, tickSpacing);
      await factory.createPool(tokenA.address, tokenB.address, swapFeeBps);
      expect(await factory.getPool(tokenA.address, tokenB.address, swapFeeBps)).to.not.be.eql(tickSpacing);
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
      await expect(factory.connect(admin).updateFeeConfiguration(admin.address, BPS)).to.be.revertedWith('invalid fee');
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
      await expect(factory.connect(admin).updateFeeConfiguration(admin.address, ZERO)).to.be.revertedWith('bad config');
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
