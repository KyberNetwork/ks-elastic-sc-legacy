import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {Wallet, BigNumber, ContractTransaction} from 'ethers';
import {BN, PRECISION, ZERO_ADDRESS, MIN_SQRT_RATIO, ONE, TWO, MIN_LIQUIDITY, MAX_SQRT_RATIO, TWO_POW_96} from '../helpers/helper';
import {encodePriceSqrt, getPriceFromTick, getNearestSpacedTickAtPrice} from '../helpers/utils';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {
  MockToken, MockToken__factory,
  MockWeth, MockWeth__factory,
  NonfungiblePositionManager, NonfungiblePositionManager__factory,
  ProAMMFactory, ProAMMPool
} from '../../typechain';

import {deployFactory} from '../helpers/proAMMSetup';
import {snapshot, revertToSnapshot} from '../helpers/hardhat';

const txGasPrice = BN.from(100).mul(BN.from(10).pow(9));
const showTxGasUsed = true;

let Token: MockToken__factory;
let PositionManager: NonfungiblePositionManager__factory;
let admin;
let user;
let factory: ProAMMFactory;
let positionManager: NonfungiblePositionManager;
let tokenA: MockToken;
let tokenB: MockToken;
let weth: MockWeth;
let swapFeeBpsArray = [5, 30];
let tickSpacingArray = [10, 60];
let initialPrice: BigNumber;
let snapshotId: any;

let getBalances: (
  who: string,
  tokens: string[]
) => Promise<{
  tokenBalances: BigNumber[]
}>


describe('NonFungiblePositionManager', () => {
  const [user, admin] = waffle.provider.getWallets();

  before('factory, token and callback setup', async () => {
    Token = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    tokenA = await Token.deploy('USDC', 'USDC', BN.from(1000000).mul(PRECISION));
    tokenB = await Token.deploy('DAI', 'DAI', BN.from(1000000).mul(PRECISION));
    factory = await deployFactory(admin);

    const WETH = (await ethers.getContractFactory('MockWeth')) as MockWeth__factory;
    weth = await WETH.deploy();

    PositionManager = (await ethers.getContractFactory('NonfungiblePositionManager')) as NonfungiblePositionManager__factory;
    positionManager = await PositionManager.deploy(factory.address, weth.address, ZERO_ADDRESS);

    // add any newly defined tickSpacing apart from default ones
    for (let i = 0; i < swapFeeBpsArray.length; i++) {
      if ((await factory.feeAmountTickSpacing(swapFeeBpsArray[i])) == 0) {
        await factory.connect(admin).enableSwapFee(swapFeeBpsArray[i], tickSpacingArray[i]);
      }
    }

    initialPrice = encodePriceSqrt(1, 1);

    await weth.connect(user).deposit({ value: PRECISION.mul(BN.from(10)) });
    await weth.connect(user).approve(positionManager.address, BN.from(2).pow(255));
    await tokenA.connect(user).approve(positionManager.address, BN.from(2).pow(255));
    await tokenB.connect(user).approve(positionManager.address, BN.from(2).pow(255));

    getBalances = async (account: string, tokens: string[]) => {
      let balances = [];
      for (let i = 0; i < tokens.length; i++) {
        if (tokens[i] == ZERO_ADDRESS) {
          balances.push(await ethers.provider.getBalance(account))
        } else {
          balances.push(await (await Token.attach(tokens[i])).balanceOf(account));
        }
      }
      return {
        tokenBalances: balances
      }
    }

    snapshotId = await snapshot();
  });

  describe(`#createAndUnlockPoolIfNecessary`, async () => {
    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
    });

    it(`revert token0 > token1`, async () => {
      let token0 = tokenA.address > tokenB.address ? tokenA.address : tokenB.address;
      let token1 = tokenA.address < tokenB.address ? tokenA.address : tokenB.address;
      await expect(positionManager.createAndUnlockPoolIfNecessary(token0, token1, swapFeeBpsArray[0], encodePriceSqrt(1, 2)))
        .to.be.reverted;
    });

    const verifyPoolBalancesAndStates = async (
      token0: string, token1: string, fee: number, initialPrice: BigNumber,
      token0Balance: BigNumber, token1Balance: BigNumber, isLocked: boolean
    ) => {
      // verify balances
      let pool = await factory.getPool(token0, token1, fee);
      let poolBalances = await getBalances(pool, [token0, token1]);
      expect(poolBalances.tokenBalances[0]).to.be.eq(token0Balance);
      expect(poolBalances.tokenBalances[1]).to.be.eq(token1Balance);

      // verify other data
      let poolContract = (await ethers.getContractAt('ProAMMPool', pool) as ProAMMPool);
      let poolState = await poolContract.getPoolState();
      expect(poolState._poolSqrtPrice).to.be.eq(initialPrice);
      expect(poolState._locked).to.be.eq(isLocked);
    }

    it(`create new pool and unlock with tokens`, async () => {
      let initialPrice = encodePriceSqrt(1, 2);

      let firstTokens = [weth.address, tokenA.address];
      let secondTokens = [tokenB.address, tokenB.address];

      let gasUsed = BN.from(0);

      for (let i = 0; i < firstTokens.length; i++) {
        let token0 = firstTokens[i] < secondTokens[i] ? firstTokens[i] : secondTokens[i];
        let token1 = firstTokens[i] > secondTokens[i] ? firstTokens[i] : secondTokens[i];

        let pool = await factory.getPool(token0, token1, swapFeeBpsArray[0]);
        expect(pool).to.be.eq(ZERO_ADDRESS);

        let userBalancesBefore = await getBalances(user.address, [token0, token1]);

        let tx = await positionManager.connect(user).createAndUnlockPoolIfNecessary(
          token0, token1, swapFeeBpsArray[0], initialPrice
        );
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);

        let userBalancesAfter = await getBalances(user.address, [token0, token1]);
        await verifyPoolBalancesAndStates(
          token0, token1, swapFeeBpsArray[0], initialPrice,
          userBalancesBefore.tokenBalances[0].sub(userBalancesAfter.tokenBalances[0]), // token0Balance
          userBalancesBefore.tokenBalances[1].sub(userBalancesAfter.tokenBalances[1]), // token1Balance
          false // isLocked
        );
      }
      if (showTxGasUsed) {
        console.log(`          Average gas used for create new pool + unlock: ${(gasUsed.div(BN.from(firstTokens.length))).toString()}`)
      }
    });

    it(`unlock exisitng pool with tokens`, async () => {
      let firstTokens = [weth.address, tokenA.address];
      let secondTokens = [tokenB.address, tokenB.address];

      let gasUsed = BN.from(0);

      for (let i = 0; i < firstTokens.length; i++) {
        let token0 = firstTokens[i] < secondTokens[i] ? firstTokens[i] : secondTokens[i];
        let token1 = firstTokens[i] > secondTokens[i] ? firstTokens[i] : secondTokens[i];
        await factory.createPool(token0, token1, swapFeeBpsArray[0]);
        await verifyPoolBalancesAndStates(
          token0, token1, swapFeeBpsArray[0], BN.from(0), BN.from(0), BN.from(0), true
        );

        let userBalancesBefore = await getBalances(user.address, [token0, token1]);

        let tx = await positionManager.connect(user).createAndUnlockPoolIfNecessary(
          token0, token1, swapFeeBpsArray[0], initialPrice
        );
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);

        let userBalancesAfter = await getBalances(user.address, [token0, token1]);
        await verifyPoolBalancesAndStates(
          token0, token1, swapFeeBpsArray[0], initialPrice,
          userBalancesBefore.tokenBalances[0].sub(userBalancesAfter.tokenBalances[0]), // token0Balance
          userBalancesBefore.tokenBalances[1].sub(userBalancesAfter.tokenBalances[1]), // token1Balance
          false // isLocked
        );
      }

      if (showTxGasUsed) {
        console.log(`          Average gas used for unlock existing pools: ${(gasUsed.div(BN.from(firstTokens.length))).toString()}`)
      }
    });

    it(`create new pool and unlock with eth`, async () => {
      let initialPrice = encodePriceSqrt(1, 2);
      let token0 = weth.address < tokenB.address ? weth.address : tokenB.address;
      let token1 = weth.address > tokenB.address ? weth.address : tokenB.address;

      let pool = await factory.getPool(token0, token1, swapFeeBpsArray[0]);
      expect(pool).to.be.eq(ZERO_ADDRESS);

      let userBalancesBefore = await getBalances(user.address, [ZERO_ADDRESS, token0, token1]);

      let multicallData = [positionManager.interface.encodeFunctionData(
        'createAndUnlockPoolIfNecessary',
        [token0, token1, swapFeeBpsArray[0], initialPrice]
      )];
      multicallData.push(positionManager.interface.encodeFunctionData('refundETH'));

      let tx = await positionManager.connect(user).multicall(multicallData, { value: PRECISION, gasPrice: txGasPrice });

      let txFee = (await tx.wait()).gasUsed.mul(txGasPrice);
      let userBalancesAfter = await getBalances(user.address, [ZERO_ADDRESS, token0, token1]);

      if (token0 == weth.address) {
        await verifyPoolBalancesAndStates(
          token0, token1, swapFeeBpsArray[0], initialPrice,
          userBalancesBefore.tokenBalances[0].sub(userBalancesAfter.tokenBalances[0]).sub(txFee),
          userBalancesBefore.tokenBalances[1].sub(userBalancesAfter.tokenBalances[1]),
          false
        );
      } else {
        await verifyPoolBalancesAndStates(
          token0, token1, swapFeeBpsArray[0], initialPrice,
          userBalancesBefore.tokenBalances[1].sub(userBalancesAfter.tokenBalances[1]),
          userBalancesBefore.tokenBalances[0].sub(userBalancesAfter.tokenBalances[0]).sub(txFee),
          false
        );
      }
      if (showTxGasUsed) {
        console.log(`          Gas used for create and unlock pool with eth: ${(await tx.wait()).gasUsed.toString()}`);
      }
    });

    it(`unlock exisiting pool with eth`, async () => {
      let initialPrice = encodePriceSqrt(1, 2);
      let token0 = weth.address < tokenB.address ? weth.address : tokenB.address;
      let token1 = weth.address > tokenB.address ? weth.address : tokenB.address;

      await factory.createPool(token0, token1, swapFeeBpsArray[0]);
      await verifyPoolBalancesAndStates(
        token0, token1, swapFeeBpsArray[0], BN.from(0), BN.from(0), BN.from(0), true
      );

      let userBalancesBefore = await getBalances(user.address, [ZERO_ADDRESS, token0, token1]);

      let multicallData = [positionManager.interface.encodeFunctionData(
        'createAndUnlockPoolIfNecessary',
        [token0, token1, swapFeeBpsArray[0], initialPrice]
      )];
      multicallData.push(positionManager.interface.encodeFunctionData('refundETH'));

      let tx = await positionManager.connect(user).multicall(multicallData, { value: PRECISION, gasPrice: txGasPrice });

      let txFee = (await tx.wait()).gasUsed.mul(txGasPrice);
      let userBalancesAfter = await getBalances(user.address, [ZERO_ADDRESS, token0, token1]);

      if (token0 == weth.address) {
        await verifyPoolBalancesAndStates(
          token0, token1, swapFeeBpsArray[0], initialPrice,
          userBalancesBefore.tokenBalances[0].sub(userBalancesAfter.tokenBalances[0]).sub(txFee),
          userBalancesBefore.tokenBalances[1].sub(userBalancesAfter.tokenBalances[1]),
          false
        );
      } else {
        await verifyPoolBalancesAndStates(
          token0, token1, swapFeeBpsArray[0], initialPrice,
          userBalancesBefore.tokenBalances[1].sub(userBalancesAfter.tokenBalances[1]),
          userBalancesBefore.tokenBalances[0].sub(userBalancesAfter.tokenBalances[0]).sub(txFee),
          false
        );
      }
      if (showTxGasUsed) {
        console.log(`          Gas used for create and unlock pool with eth: ${(await tx.wait()).gasUsed.toString()}`);
      }
    });
  });


});
