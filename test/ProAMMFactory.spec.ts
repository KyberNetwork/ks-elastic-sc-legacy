import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {BN, PRECISION, ZERO_ADDRESS, BPS_PLUS_ONE, ZERO, ONE, BPS} from './helpers/helper';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {
  ProAMMFactory,
  ReinvestmentTokenMaster,
  ProAMMPool,
  MockToken,
  MockToken__factory,
  PredictPoolAddress,
} from '../typechain';
import {deployFactory, deployProAMMPoolMaster, deployReinvestmentTokenMaster} from './helpers/proAMMSetup';
import {snapshot, revertToSnapshot} from './helpers/hardhat';

let Token: MockToken__factory;
let factory: ProAMMFactory;
let poolAddressPredictor: PredictPoolAddress;
let reinvestmentMaster: ReinvestmentTokenMaster;
let poolMaster: ProAMMPool;
let tokenA: MockToken;
let tokenB: MockToken;
let swapFeeBps: number;
let tickSpacing: number;

let snapshotId: any;

describe('ProAMMFactory', () => {
  const [operator, admin, feeToSetter] = waffle.provider.getWallets();

  before('setup', async () => {
    let poolAddressPredictorFactory = await ethers.getContractFactory('PredictPoolAddress');
    poolAddressPredictor = (await poolAddressPredictorFactory.deploy()) as PredictPoolAddress;
    reinvestmentMaster = await deployReinvestmentTokenMaster(ethers);
    poolMaster = await deployProAMMPoolMaster(ethers);
    Token = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    tokenA = await Token.deploy('USDC', 'USDC', BN.from(1000).mul(PRECISION));
    tokenB = await Token.deploy('DAI', 'DAI', BN.from(1000).mul(PRECISION));
    factory = await deployFactory(ethers, admin, reinvestmentMaster.address, poolMaster.address);
    snapshotId = await snapshot();
  });

  describe('#factory deployment and pool creation', async () => {
    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
      swapFeeBps = 5;
      tickSpacing = 10;
    });

    it('should have initialized with the expected settings', async () => {
      expect(await factory.feeToSetter()).to.eql(admin.address);
      expect(await factory.reinvestmentTokenMaster()).to.eql(reinvestmentMaster.address);
      expect(await factory.poolMaster()).to.eql(poolMaster.address);
      expect(await factory.feeAmountTickSpacing(5)).to.eql(10);
      expect(await factory.feeAmountTickSpacing(30)).to.eql(60);
      let result = await factory.getFeeConfiguration();
      expect(result._feeTo).to.eql(ZERO_ADDRESS);
      expect(result._governmentFeeBps).to.eql(0);
    });

    it('should be able to deploy a pool', async () => {
      let expectedPoolAddress = await poolAddressPredictor.predictPoolAddress(
        factory.address,
        poolMaster.address,
        tokenA.address,
        tokenB.address,
        swapFeeBps
      );
      let token0Address = tokenA.address.toLowerCase() < tokenB.address.toLowerCase() ? tokenA.address : tokenB.address;
      let token1Address = token0Address == tokenA.address ? tokenB.address : tokenA.address;
      await expect(factory.createPool(tokenA.address, tokenB.address, swapFeeBps))
        .to.emit(factory, 'PoolCreated')
        .withArgs(token0Address, token1Address, swapFeeBps, 10, expectedPoolAddress);

      swapFeeBps = 30;
      expectedPoolAddress = await poolAddressPredictor.predictPoolAddress(
        factory.address,
        poolMaster.address,
        tokenA.address,
        tokenB.address,
        swapFeeBps
      );

      await expect(factory.createPool(tokenA.address, tokenB.address, swapFeeBps))
        .to.emit(factory, 'PoolCreated')
        .withArgs(token0Address, token1Address, swapFeeBps, 60, expectedPoolAddress);
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
    });

    describe('#updateFeeToSetter', async () => {
      it('should revert if msg.sender != feeToSetter', async () => {
        await expect(factory.connect(operator).updateFeeToSetter(feeToSetter.address)).to.be.revertedWith('forbidden');
      });

      it('should correctly update feeToSetter and emit event', async () => {
        await expect(factory.connect(admin).updateFeeToSetter(feeToSetter.address))
          .to.emit(factory, 'FeeToSetterUpdated')
          .withArgs(admin.address, feeToSetter.address);

        expect(await factory.feeToSetter()).to.eql(feeToSetter.address);
        // admin should not be able to update configurations
        await expect(factory.connect(admin).updateFeeToSetter(feeToSetter.address)).to.be.revertedWith('forbidden');
        await expect(factory.connect(admin).enableSwapFee(swapFeeBps, tickSpacing)).to.be.revertedWith('forbidden');
        await expect(factory.connect(admin).setFeeConfiguration(admin.address, swapFeeBps)).to.be.revertedWith(
          'forbidden'
        );
        // feeToSetter should be able to update
        await factory.connect(feeToSetter).enableSwapFee(swapFeeBps, tickSpacing);
        await factory.connect(feeToSetter).setFeeConfiguration(admin.address, swapFeeBps);
      });
    });

    describe('#enableSwapFee', async () => {
      it('should revert enableSwapFee if msg.sender != feeToSetter', async () => {
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

    describe('#setFeeConfiguration', async () => {
      it('should revert if msg.sender != feeToSetter', async () => {
        await expect(factory.connect(operator).setFeeConfiguration(admin.address, ONE)).to.be.revertedWith(
          'forbidden'
        );
      });

      it('should revert for invalid governmentFeeBps', async () => {
        await expect(factory.connect(admin).setFeeConfiguration(admin.address, 2001)).to.be.revertedWith(
          'invalid fee'
        );
        await expect(factory.connect(admin).setFeeConfiguration(admin.address, BPS)).to.be.revertedWith('invalid fee');
      });

      it('should set new feeTo and governmentFeeBps, and emit event', async () => {
        let governmentFeeBps = 50;
        await expect(factory.connect(admin).setFeeConfiguration(admin.address, governmentFeeBps))
          .to.emit(factory, 'SetFeeConfiguration')
          .withArgs(admin.address, governmentFeeBps);
        let result = await factory.getFeeConfiguration();
        expect(result._feeTo).to.be.eql(admin.address);
        expect(result._governmentFeeBps).to.be.eql(governmentFeeBps);

        // change feeToSetter
        await factory.connect(admin).updateFeeToSetter(operator.address);
        governmentFeeBps = 20;
        // operator updates fee config
        await factory.connect(operator).setFeeConfiguration(operator.address, governmentFeeBps);
        result = await factory.getFeeConfiguration();
        expect(result._feeTo).to.be.eql(operator.address);
        expect(result._governmentFeeBps).to.be.eql(governmentFeeBps);
      });

      it('should be able to update governmentFeeBps to min (0) and max (2000) values', async () => {
        let governmentFeeBps = 0;
        await factory.connect(admin).setFeeConfiguration(admin.address, governmentFeeBps);
        let result = await factory.getFeeConfiguration();
        expect(result._feeTo).to.be.eql(admin.address);
        expect(result._governmentFeeBps).to.be.eql(governmentFeeBps);

        governmentFeeBps = 2000;
        await factory.connect(admin).setFeeConfiguration(operator.address, governmentFeeBps);
        result = await factory.getFeeConfiguration();
        expect(result._feeTo).to.be.eql(operator.address);
        expect(result._governmentFeeBps).to.be.eql(governmentFeeBps);
      });
    });
  });
});
