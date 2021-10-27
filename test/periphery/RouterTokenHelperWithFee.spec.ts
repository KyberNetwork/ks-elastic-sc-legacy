import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {BigNumber as BN} from 'ethers';
import {PRECISION, ONE, ZERO, MAX_UINT, BPS} from '../helpers/helper';
import chai from 'chai';
const {solidity, loadFixture} = waffle;
chai.use(solidity);

import {
  MockToken,
  MockToken__factory,
  MockWeth,
  MockWeth__factory,
  MockRouterTokenHelperWithFee__factory,
  MockRouterTokenHelperWithFee,
  Factory,
} from '../../typechain';
import {deployFactory} from '../helpers/setup';

let TokenFactory: MockToken__factory;
let tokenHelper: MockRouterTokenHelperWithFee;
let tokenA: MockToken;
let tokenB: MockToken;
let weth: MockWeth;
let factory: Factory;
let tokens: [MockToken, MockToken, MockWeth];
let feeBps = 100;

describe('LiquidityHelper', () => {
  const [user, admin, feeRecipient] = waffle.provider.getWallets();

  async function fixture() {
    TokenFactory = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    tokenA = await TokenFactory.deploy('USDC', 'USDC', BN.from(1000000).mul(PRECISION));
    tokenB = await TokenFactory.deploy('DAI', 'DAI', BN.from(1000000).mul(PRECISION));
    factory = await deployFactory(admin, ZERO);

    const WETHContract = (await ethers.getContractFactory('MockWeth')) as MockWeth__factory;
    weth = await WETHContract.deploy();
    tokens = [tokenA, tokenB, weth];

    const TokenHelper = (await ethers.getContractFactory(
      'MockRouterTokenHelperWithFee'
    )) as MockRouterTokenHelperWithFee__factory;

    let instance = await TokenHelper.deploy(factory.address, weth.address);
    return instance;
  }

  beforeEach('load fixture', async () => {
    tokenHelper = await loadFixture(fixture);
  });

  describe('zero funds in contract', async () => {
    it('should do nothing for unwrapWethWithFee()', async () => {
      await tokenHelper.unwrapWethWithFee(ZERO, user.address, feeBps, user.address);
    });

    it('should do nothing for transferAllTokensWithFee()', async () => {
      tokens.forEach(async (token) => {
        await tokenHelper.transferAllTokensWithFee(token.address, ZERO, user.address, feeBps, user.address);
      });
    });
  });

  describe('non-zero funds in contract', async () => {
    beforeEach('transfer assets to contract', async () => {
      await tokenA.transfer(tokenHelper.address, PRECISION.mul(200000));
      await tokenB.transfer(tokenHelper.address, PRECISION.mul(200000));
      await weth.connect(user).deposit({value: PRECISION.mul(5)});
      await weth.transfer(tokenHelper.address, PRECISION.mul(5));
    });

    it('should be unable to receive ETH', async () => {
      await expect(
        user.sendTransaction({
          to: tokenHelper.address,
          value: PRECISION,
        })
      ).to.be.revertedWith('Not WETH');
    });

    it('should revert for invalid fee bps', async () => {
      await expect(tokenHelper.unwrapWethWithFee(ZERO, user.address, ZERO, user.address)).to.be.revertedWith(
        'High fee'
      );
      await expect(tokenHelper.unwrapWethWithFee(ZERO, user.address, 101, user.address)).to.be.revertedWith(
        'High fee'
      );
      await expect(tokenHelper.unwrapWethWithFee(ZERO, user.address, BPS, user.address)).to.be.revertedWith(
        'High fee'
      );

      tokens.forEach(async (token) => {
        await expect(
          tokenHelper.transferAllTokensWithFee(token.address, ZERO, user.address, ZERO, user.address)
        ).to.be.revertedWith('High fee');
        await expect(
          tokenHelper.transferAllTokensWithFee(token.address, ZERO, user.address, 101, user.address)
        ).to.be.revertedWith('High fee');
        await expect(
          tokenHelper.transferAllTokensWithFee(token.address, ZERO, user.address, BPS, user.address)
        ).to.be.revertedWith('High fee');
      });
    });

    it('should revert if there are insufficient funds in the contract', async () => {
      await expect(tokenHelper.unwrapWeth(MAX_UINT, user.address)).to.be.revertedWith('Insufficient WETH');
      let balance = await weth.balanceOf(tokenHelper.address);
      await expect(tokenHelper.unwrapWeth(balance.add(ONE), user.address)).to.be.revertedWith('Insufficient WETH');

      await expect(tokenHelper.unwrapWethWithFee(MAX_UINT, user.address, feeBps, user.address)).to.be.revertedWith(
        'Insufficient WETH'
      );
      balance = await weth.balanceOf(tokenHelper.address);
      await expect(
        tokenHelper.unwrapWethWithFee(balance.add(ONE), user.address, feeBps, user.address)
      ).to.be.revertedWith('Insufficient WETH');

      tokens.forEach(async (token) => {
        await expect(
          tokenHelper.transferAllTokensWithFee(token.address, MAX_UINT, user.address, feeBps, user.address)
        ).to.be.revertedWith('Insufficient token');
        balance = await token.balanceOf(tokenHelper.address);
        await expect(
          tokenHelper.transferAllTokensWithFee(token.address, balance.add(ONE), user.address, feeBps, user.address)
        ).to.be.revertedWith('Insufficient token');
      });
    });

    it('should transfer ETH to both recipient and fee recipient', async () => {
      let recipientBalBefore = await ethers.provider.getBalance(admin.address);
      let feeRecipientBalBefore = await ethers.provider.getBalance(feeRecipient.address);
      let contractBal = await weth.balanceOf(tokenHelper.address);
      await tokenHelper.unwrapWethWithFee(PRECISION, admin.address, feeBps, feeRecipient.address);

      let recipientBalAfter = await ethers.provider.getBalance(admin.address);
      let feeRecipientBalAfter = await ethers.provider.getBalance(feeRecipient.address);

      let feeAmt = contractBal.mul(feeBps).div(BPS);
      expect(recipientBalAfter.sub(recipientBalBefore)).to.be.eq(contractBal.sub(feeAmt));
      expect(feeRecipientBalAfter.sub(feeRecipientBalBefore)).to.be.eq(feeAmt);
    });

    it('should have ETH remain in RouterTokenHelper if it is the recipient', async () => {
      // tokenHelper is recipient
      let recipientBalBefore = await ethers.provider.getBalance(tokenHelper.address);
      let feeRecipientBalBefore = await ethers.provider.getBalance(feeRecipient.address);
      let contractBal = await weth.balanceOf(tokenHelper.address);
      await tokenHelper.unwrapWethWithFee(PRECISION, tokenHelper.address, feeBps, feeRecipient.address);

      let recipientBalAfter = await ethers.provider.getBalance(tokenHelper.address);
      let feeRecipientBalAfter = await ethers.provider.getBalance(feeRecipient.address);

      let feeAmt = contractBal.mul(feeBps).div(BPS);
      expect(recipientBalAfter.sub(recipientBalBefore)).to.be.eq(contractBal.sub(feeAmt));
      expect(feeRecipientBalAfter.sub(feeRecipientBalBefore)).to.be.eq(feeAmt);
    });

    it('should have ETH remain in RouterTokenHelper if it is the fee recipient', async () => {
      // tokenHelper is fee recipient
      let recipientBalBefore = await ethers.provider.getBalance(admin.address);
      let feeRecipientBalBefore = await ethers.provider.getBalance(tokenHelper.address);
      let contractBal = await weth.balanceOf(tokenHelper.address);
      await tokenHelper.unwrapWethWithFee(PRECISION, admin.address, feeBps, tokenHelper.address);

      let recipientBalAfter = await ethers.provider.getBalance(admin.address);
      let feeRecipientBalAfter = await ethers.provider.getBalance(tokenHelper.address);

      let feeAmt = contractBal.mul(feeBps).div(BPS);
      expect(recipientBalAfter.sub(recipientBalBefore)).to.be.eq(contractBal.sub(feeAmt));
      expect(feeRecipientBalAfter.sub(feeRecipientBalBefore)).to.be.eq(feeAmt);
    });

    it('should revert if either recipient or fee recipient cannot receive ETH', async () => {
      await expect(
        tokenHelper.unwrapWethWithFee(PRECISION, factory.address, feeBps, feeRecipient.address)
      ).to.be.revertedWith('transfer eth failed');

      await expect(
        tokenHelper.unwrapWethWithFee(PRECISION, admin.address, feeBps, factory.address)
      ).to.be.revertedWith('transfer eth failed');
    });

    it('should transfer tokens to both recipient and fee recipient', async () => {
      tokens.forEach(async (token) => {
        let recipientBalBefore = await token.balanceOf(admin.address);
        let feeRecipientBalBefore = await token.balanceOf(feeRecipient.address);
        let contractBal = await token.balanceOf(tokenHelper.address);

        await tokenHelper.transferAllTokensWithFee(
          token.address,
          PRECISION,
          admin.address,
          feeBps,
          feeRecipient.address
        );

        let recipientBalAfter = await token.balanceOf(admin.address);
        let feeRecipientBalAfter = await token.balanceOf(feeRecipient.address);

        let feeAmt = contractBal.mul(feeBps).div(BPS);
        expect(recipientBalAfter.sub(recipientBalBefore)).to.be.eq(contractBal.sub(feeAmt));
        expect(feeRecipientBalAfter.sub(feeRecipientBalBefore)).to.be.eq(feeAmt);
      });
    });
  });
});
