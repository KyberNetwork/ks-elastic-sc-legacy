import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {Wallet, BigNumber, ContractTransaction} from 'ethers';
import {BN, PRECISION, ZERO_ADDRESS, TWO_POW_96} from '../helpers/helper';
import {encodePriceSqrt} from '../helpers/utils';
import getEC721PermitSignature from '../helpers/getEC721PermitSignature';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {
  MockToken, MockToken__factory,
  MockWeth, MockWeth__factory,
  NonfungiblePositionManager, NonfungiblePositionManager__factory,
  ProAMMFactory, ProAMMPool, ProAMMRouter__factory,
  MockTokenPositionDescriptor, MockTokenPositionDescriptor__factory
} from '../../typechain';

import {deployFactory} from '../helpers/proAMMSetup';
import {snapshot, revertToSnapshot} from '../helpers/hardhat';
import { ProAMMRouter } from '../../typechain/ProAMMRouter';

const txGasPrice = BN.from(100).mul(BN.from(10).pow(9));
const showTxGasUsed = true;

const BIG_AMOUNT = BN.from(2).pow(255);

let Token: MockToken__factory;
let PositionManager: NonfungiblePositionManager__factory;
let admin;
let user;
let factory: ProAMMFactory;
let positionManager: NonfungiblePositionManager;
let router: ProAMMRouter;
let tokenDescriptor: MockTokenPositionDescriptor;
let tokenA: MockToken;
let tokenB: MockToken;
let weth: MockWeth;
let nextTokenId: BigNumber;
let swapFeeBpsArray = [5, 30];
let tickDistanceArray = [10, 60];
let vestingPeriod = 0;
let initialPrice: BigNumber;
let snapshotId: any;
let initialSnapshotId: any;

let getBalances: (
  who: string,
  tokens: string[]
) => Promise<{
  tokenBalances: BigNumber[]
}>

describe('NonFungiblePositionManager', () => {
  const [user, admin, other] = waffle.provider.getWallets();
  const tickLower = -100 * tickDistanceArray[0];
  const tickUpper = 100 * tickDistanceArray[0];

  before('factory, token and callback setup', async () => {
    Token = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    tokenA = await Token.deploy('USDC', 'USDC', BN.from(100000000000).mul(PRECISION));
    tokenB = await Token.deploy('DAI', 'DAI', BN.from(100000000000).mul(PRECISION));
    factory = await deployFactory(admin, vestingPeriod);

    const WETH = (await ethers.getContractFactory('MockWeth')) as MockWeth__factory;
    weth = await WETH.deploy();

    const Descriptor = (await ethers.getContractFactory('MockTokenPositionDescriptor')) as MockTokenPositionDescriptor__factory;
    tokenDescriptor = await Descriptor.deploy();

    PositionManager = (await ethers.getContractFactory('NonfungiblePositionManager')) as NonfungiblePositionManager__factory;
    positionManager = await PositionManager.deploy(factory.address, weth.address, tokenDescriptor.address);
    await factory.connect(admin).addNFTManager(positionManager.address);

    const Router = (await ethers.getContractFactory('ProAMMRouter')) as ProAMMRouter__factory;
    router = await Router.deploy(factory.address, weth.address);

    // add any newly defined tickDistance apart from default ones
    for (let i = 0; i < swapFeeBpsArray.length; i++) {
      if ((await factory.feeAmountTickSpacing(swapFeeBpsArray[i])) == 0) {
        await factory.connect(admin).enableSwapFee(swapFeeBpsArray[i], tickDistanceArray[i]);
      }
    }

    initialPrice = encodePriceSqrt(1, 1);

    await weth.connect(user).deposit({ value: PRECISION.mul(10) });
    await weth.connect(other).deposit({ value: PRECISION.mul(10) });

    let users = [user, other];
    for (let i = 0; i < users.length; i++) {
      await weth.connect(users[i]).approve(positionManager.address, BIG_AMOUNT);
      await tokenA.connect(users[i]).approve(positionManager.address, BIG_AMOUNT);
      await tokenB.connect(users[i]).approve(positionManager.address, BIG_AMOUNT);

      await weth.connect(users[i]).approve(router.address, BIG_AMOUNT);
      await tokenA.connect(users[i]).approve(router.address, BIG_AMOUNT);
      await tokenB.connect(users[i]).approve(router.address, BIG_AMOUNT);

      await tokenA.transfer(users[i].address, PRECISION.mul(2000000));
      await tokenB.transfer(users[i].address, PRECISION.mul(2000000));
    }

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

    initialSnapshotId = await snapshot();
    snapshotId = initialSnapshotId;
  });

  describe(`#createAndUnlockPoolIfNecessary`, async () => {
    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
    });

    it(`revert token0 > token1`, async () => {
      let [token1, token0] = sortTokens(tokenA.address, tokenB.address);
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
        let [token0, token1] = sortTokens(firstTokens[i], secondTokens[i]);

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
        let [token0, token1] = sortTokens(firstTokens[i], secondTokens[i]);
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
      let [token0, token1] = sortTokens(weth.address, tokenB.address);

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
          userBalancesBefore.tokenBalances[2].sub(userBalancesAfter.tokenBalances[2]),
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
      let [token0, token1] = sortTokens(weth.address, tokenB.address);

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
          userBalancesBefore.tokenBalances[2].sub(userBalancesAfter.tokenBalances[2]),
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

  const createAndUnlockPools = async () => {
    let initialPrice = encodePriceSqrt(1, 1);
    let [token0, token1] = sortTokens(tokenA.address, tokenB.address);
    await positionManager.connect(user).createAndUnlockPoolIfNecessary(
      token0, token1, swapFeeBpsArray[0], initialPrice
    );
    [token0, token1] = sortTokens(tokenA.address, weth.address);
    await positionManager.connect(user).createAndUnlockPoolIfNecessary(
      token0, token1, swapFeeBpsArray[0], initialPrice
    );
    [token0, token1] = sortTokens(tokenB.address, weth.address);
    await positionManager.connect(user).createAndUnlockPoolIfNecessary(
      token0, token1, swapFeeBpsArray[0], initialPrice
    );
  }

  describe(`#mint`, async () => {
    before('create and unlock pools', async () => {
      await revertToSnapshot(initialSnapshotId);
      await createAndUnlockPools();
      snapshotId = await snapshot();
    });

    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
      nextTokenId = await positionManager.nextTokenId();
    });

    it('revert invalid token pair', async () => {
      let [token1, token0] = sortTokens(tokenA.address, tokenB.address);
      await expect(positionManager.connect(user).mint({
        token0: token0, token1: token1, fee: swapFeeBpsArray[0],
        tickLower: 0, tickUpper: 0, amount0Desired: 0, amount1Desired: 0,
        amount0Min: 0, amount1Min: 0, recipient: user.address, deadline: PRECISION
      })).to.be.revertedWith('LiquidityHelper: invalid token order');
    });

    it('revert expired', async () => {
      let [token0, token1] = sortTokens(tokenA.address, tokenB.address);
      await expect(positionManager.connect(user).mint({
        token0: token0, token1: token1, fee: swapFeeBpsArray[0],
        tickLower: 0, tickUpper: 0, amount0Desired: 0, amount1Desired: 0,
        amount0Min: 0, amount1Min: 0, recipient: user.address, deadline: 0
      })).to.be.revertedWith('ProAMM: Expired');
    });

    it('revert pool does not exist', async () => {
      let newToken = await Token.deploy('KNC', 'KNC', BN.from(1000000).mul(PRECISION));
      let [token0, token1] = sortTokens(tokenA.address, newToken.address);
      await expect(positionManager.connect(user).mint({
        token0: token0, token1: token1, fee: swapFeeBpsArray[0],
        tickLower: 0, tickUpper: 0, amount0Desired: 0, amount1Desired: 0,
        amount0Min: 0, amount1Min: 0, recipient: user.address, deadline: 0
      })).to.be.reverted;
    });

    it('revert price slippage', async () => {
      let [token0, token1] = sortTokens(tokenA.address, tokenB.address);
      await expect(positionManager.connect(user).mint({
        token0: token0, token1: token1, fee: swapFeeBpsArray[0],
        tickLower: -tickDistanceArray[0], tickUpper: tickDistanceArray[0],
        amount0Desired: BN.from(1000000), amount1Desired: BN.from(1000000),
        amount0Min: BN.from(1000001), amount1Min: 0, recipient: user.address, deadline: PRECISION
      })).to.be.revertedWith('LiquidityHelper: price slippage check');
      await expect(positionManager.connect(user).mint({
        token0: token0, token1: token1, fee: swapFeeBpsArray[0],
        tickLower: -tickDistanceArray[0], tickUpper: tickDistanceArray[0],
        amount0Desired: BN.from(1000000), amount1Desired: BN.from(1000000),
        amount0Min: 0, amount1Min: BN.from(1000001), recipient: user.address, deadline: PRECISION
      })).to.be.revertedWith('LiquidityHelper: price slippage check');
    });

    it('revert not enough token', async () => {
      let [token0, token1] = sortTokens(tokenA.address, tokenB.address);
      await tokenA.connect(user).approve(positionManager.address, 0);
      await expect(positionManager.connect(user).mint({
        token0: token0, token1: token1, fee: swapFeeBpsArray[0],
        tickLower: -tickDistanceArray[0], tickUpper: tickDistanceArray[0],
        amount0Desired: BN.from(1000000), amount1Desired: BN.from(1000000),
        amount0Min: 0, amount1Min: 0, recipient: user.address, deadline: PRECISION
      })).to.be.reverted;
      await tokenA.connect(user).approve(positionManager.address, BIG_AMOUNT);
      await tokenB.connect(user).approve(positionManager.address, 0);
      await expect(positionManager.connect(user).mint({
        token0: token0, token1: token1, fee: swapFeeBpsArray[0],
        tickLower: -tickDistanceArray[0], tickUpper: tickDistanceArray[0],
        amount0Desired: BN.from(1000000), amount1Desired: BN.from(1000000),
        amount0Min: 0, amount1Min: 0, recipient: user.address, deadline: PRECISION
      })).to.be.reverted;
      await tokenB.connect(user).approve(positionManager.address, BIG_AMOUNT);
    });

    it('mint & create new token', async () => {
      let [token0, token1] = sortTokens(tokenA.address, tokenB.address);

      let recipients = [user.address, other.address];
      let gasUsed = BN.from(0);

      let _nextTokenId = nextTokenId;
      let poolId = 1;

      let poolAddress = await factory.getPool(token0, token1, swapFeeBpsArray[0]);

      for (let i = 0; i < recipients.length; i++) {

        let tickLower = tickDistanceArray[0] * (i + 1) * -10;
        let tickUpper = tickDistanceArray[0] * (i + 1) * 10;

        let userBalanceBefore = await getBalances(user.address, [token0, token1]);
        let poolBalanceBefore = await getBalances(poolAddress, [token0, token1]);
        let tx = await positionManager.connect(user).mint({
          token0: token0, token1: token1, fee: swapFeeBpsArray[0],
          tickLower: tickLower, tickUpper: tickUpper,
          amount0Desired: BN.from(1000000), amount1Desired: BN.from(1000000),
          amount0Min: 0, amount1Min: 0, recipient: recipients[i], deadline: PRECISION
        });
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);

        // verify balances
        let userBalanceAfter = await getBalances(user.address, [token0, token1]);
        let poolBalanceAfter = await getBalances(poolAddress, [token0, token1]);
        expect(poolBalanceAfter.tokenBalances[0].sub(poolBalanceBefore.tokenBalances[0])).to.be.eq(
          userBalanceBefore.tokenBalances[0].sub(userBalanceAfter.tokenBalances[0])
        );
        expect(poolBalanceAfter.tokenBalances[1].sub(poolBalanceBefore.tokenBalances[1])).to.be.eq(
          userBalanceBefore.tokenBalances[1].sub(userBalanceAfter.tokenBalances[1])
        );

        // verify user should be the owner of _nextTokenId
        expect(await positionManager.balanceOf(recipients[i])).to.be.eq(1);
        expect(await positionManager.tokenOfOwnerByIndex(recipients[i], 0)).to.be.eq(_nextTokenId);
        expect(await positionManager.ownerOf(_nextTokenId)).to.be.eq(recipients[i]);

        // verify position and pool info in PositionManager
        let pool = (await ethers.getContractAt('ProAMMPool', poolAddress) as ProAMMPool);
        const { pos, info } = await positionManager.positions(_nextTokenId);
        expect(info.token0).to.be.eq(token0);
        expect(info.token1).to.be.eq(token1);
        expect(info.fee).to.be.eq(swapFeeBpsArray[0]);
        expect(info.rToken).to.be.eq(await pool.reinvestmentToken());
        expect(await positionManager.isRToken(info.rToken)).to.be.eq(true);
        expect(await positionManager.addressToPoolId(poolAddress)).to.be.eq(poolId);
        expect(pos.nonce).to.be.eq(0);
        expect(pos.operator).to.be.eq(ZERO_ADDRESS);
        expect(pos.poolId).to.be.eq(poolId); // poolId should be the same for both cases
        expect(pos.rTokenOwed).to.be.eq(0);
        expect(pos.tickLower).to.be.eq(tickLower);
        expect(pos.tickUpper).to.be.eq(tickUpper);

        // check liquidity & fee growth record
        const { liquidity, feeGrowthInsideLast } = await pool.getPositions(positionManager.address, tickLower, tickUpper);
        expect(liquidity).to.be.eq(pos.liquidity);
        expect(feeGrowthInsideLast).to.be.eq(pos.feeGrowthInsideLast);

        _nextTokenId = _nextTokenId.add(1);
      }
      if (showTxGasUsed) {
        logMessage(`Average mint gas: ${(gasUsed.div(BN.from(recipients.length))).toString()}`);
      }
    });

    it('mint with eth using multicall', async () => {
      let [token0, token1] = sortTokens(weth.address, tokenB.address);

      let recipients = [user.address, other.address];
      let gasUsed = BN.from(0);

      let _nextTokenId = nextTokenId;
      let poolId = 1;

      let poolAddress = await factory.getPool(token0, token1, swapFeeBpsArray[0]);

      for (let i = 0; i < recipients.length; i++) {

        let tickLower = tickDistanceArray[0] * (i + 1) * -10;
        let tickUpper = tickDistanceArray[0] * (i + 1) * 10;

        let userBalanceBefore = await getBalances(user.address, [ZERO_ADDRESS, token0, token1]);
        let poolBalanceBefore = await getBalances(poolAddress, [token0, token1]);

        let amount = BN.from(1000000000);
        let mintParams = {
          token0: token0, token1: token1, fee: swapFeeBpsArray[0],
          tickLower: tickLower, tickUpper: tickUpper,
          amount0Desired: amount, amount1Desired: amount,
          amount0Min: BN.from(0), amount1Min: BN.from(0), recipient: recipients[i], deadline: PRECISION
        }
        let multicallData = [positionManager.interface.encodeFunctionData('mint', [mintParams])];
        multicallData.push(positionManager.interface.encodeFunctionData('refundETH'));
        let tx = await positionManager.connect(user).multicall(multicallData, { value: amount, gasPrice: txGasPrice });
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);
        let txFee = (await tx.wait()).gasUsed.mul(txGasPrice);

        let userBalanceAfter = await getBalances(user.address, [ZERO_ADDRESS, token0, token1]);
        let poolBalanceAfter = await getBalances(poolAddress, [token0, token1]);
        if (token0 == weth.address) {
          expect(poolBalanceAfter.tokenBalances[0].sub(poolBalanceBefore.tokenBalances[0])).to.be.eq(
            userBalanceBefore.tokenBalances[0].sub(userBalanceAfter.tokenBalances[0]).sub(txFee)
          )
          expect(poolBalanceAfter.tokenBalances[1].sub(poolBalanceBefore.tokenBalances[1])).to.be.eq(
            userBalanceBefore.tokenBalances[2].sub(userBalanceAfter.tokenBalances[2])
          )
        } else {
          expect(poolBalanceAfter.tokenBalances[1].sub(poolBalanceBefore.tokenBalances[1])).to.be.eq(
            userBalanceBefore.tokenBalances[0].sub(userBalanceAfter.tokenBalances[0]).sub(txFee)
          )
          expect(poolBalanceAfter.tokenBalances[0].sub(poolBalanceBefore.tokenBalances[0])).to.be.eq(
            userBalanceBefore.tokenBalances[1].sub(userBalanceAfter.tokenBalances[1])
          )
        }

        // verify user should be the owner of _nextTokenId
        expect(await positionManager.balanceOf(recipients[i])).to.be.eq(1);
        expect(await positionManager.tokenOfOwnerByIndex(recipients[i], 0)).to.be.eq(_nextTokenId);
        expect(await positionManager.ownerOf(_nextTokenId)).to.be.eq(recipients[i]);

        // verify position and pool info in PositionManager
        let pool = (await ethers.getContractAt('ProAMMPool', poolAddress) as ProAMMPool);
        const { pos, info } = await positionManager.positions(_nextTokenId);
        expect(info.token0).to.be.eq(token0);
        expect(info.token1).to.be.eq(token1);
        expect(info.fee).to.be.eq(swapFeeBpsArray[0]);
        expect(info.rToken).to.be.eq(await pool.reinvestmentToken());
        expect(await positionManager.isRToken(info.rToken)).to.be.eq(true);
        expect(await positionManager.addressToPoolId(poolAddress)).to.be.eq(poolId);
        expect(pos.nonce).to.be.eq(0);
        expect(pos.operator).to.be.eq(ZERO_ADDRESS);
        expect(pos.poolId).to.be.eq(poolId); // poolId should be the same for both cases
        expect(pos.rTokenOwed).to.be.eq(0);
        expect(pos.tickLower).to.be.eq(tickLower);
        expect(pos.tickUpper).to.be.eq(tickUpper);

        // check liquidity & fee growth record
        const { liquidity, feeGrowthInsideLast } = await pool.getPositions(positionManager.address, tickLower, tickUpper);
        expect(liquidity).to.be.eq(pos.liquidity);
        expect(feeGrowthInsideLast).to.be.eq(pos.feeGrowthInsideLast);

        _nextTokenId = _nextTokenId.add(1);
      }
      if (showTxGasUsed) {
        logMessage(`Average mint gas: ${(gasUsed.div(BN.from(recipients.length))).toString()}`);
      }
    });
  });

  const initLiquidity = async (user: Wallet, token0: string, token1: string) => {
    [token0, token1] = sortTokens(token0, token1);
    await positionManager.connect(user).mint({
      token0: token0, token1: token1, fee: swapFeeBpsArray[0],
      tickLower: -100 * tickDistanceArray[0], tickUpper: 100 * tickDistanceArray[0],
      amount0Desired: BN.from(1000000), amount1Desired: BN.from(1000000),
      amount0Min: 0, amount1Min: 0, recipient: user.address, deadline: PRECISION
    });
  }

  const swapExactInput = async function (
    tokenIn: string, tokenOut: string, poolFee: number, amount: BigNumber
  ) {
    const swapParams = {
      tokenIn: tokenIn,
      tokenOut: tokenOut,
      fee: poolFee,
      recipient: user.address,
      deadline: BN.from(2).pow(255),
      amountIn: amount,
      amountOutMinimum: BN.from(0),
      sqrtPriceLimitX96: BN.from(0)
    };
    await router.connect(user).swapExactInputSingle(swapParams);
  };

  const burnRTokens = async function (tokenIn: string, tokenOut: string, user: Wallet, tokenId: BigNumber)
    : Promise<ContractTransaction>
  {
    // call to burn rTokens
    let burnRTokenParams = {
      tokenId: tokenId, amount0Min: 0, amount1Min: 0, deadline: PRECISION
    }
    let multicallData = [positionManager.interface.encodeFunctionData('burnRTokens', [burnRTokenParams])]
    multicallData.push(positionManager.interface.encodeFunctionData('transferAllTokens', [tokenIn, 0, user.address]));
    multicallData.push(positionManager.interface.encodeFunctionData('transferAllTokens', [tokenOut, 0, user.address]));
    let tx = await positionManager.connect(user).multicall(multicallData);
    return tx;
  }

  const removeLiquidity = async function (tokenIn: string, tokenOut: string, user: Wallet, tokenId: BigNumber, liquidity: BigNumber)
    : Promise<ContractTransaction>
  {
    let removeLiquidityParams = {
      tokenId: tokenId, liquidity: liquidity,
      amount0Min: 0, amount1Min: 0, deadline: PRECISION
    }
    // need to use multicall to collect tokens
    let multicallData = [positionManager.interface.encodeFunctionData('removeLiquidity', [removeLiquidityParams])];
    multicallData.push(positionManager.interface.encodeFunctionData('transferAllTokens', [tokenIn, 0, user.address]));
    multicallData.push(positionManager.interface.encodeFunctionData('transferAllTokens', [tokenOut, 0, user.address]));
    let tx = await positionManager.connect(user).multicall(multicallData);
    return tx;
  }

  describe(`#add liquidity`, async () => {
    before('create and unlock pools', async () => {
      await revertToSnapshot(initialSnapshotId);
      await createAndUnlockPools();
      snapshotId = await snapshot();
    });

    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
      nextTokenId = await positionManager.nextTokenId();
    });

    it('revert invalid token id', async () => {
      await expect(positionManager.connect(user).addLiquidity({
        tokenId: 0, amount0Desired: 0, amount1Desired: 0,
        amount0Min: 0, amount1Min: 0, deadline: PRECISION
      })).to.be.reverted;
      await initLiquidity(user, tokenA.address, tokenB.address);
      // token id should not exist
      await expect(positionManager.connect(user).addLiquidity({
        tokenId: nextTokenId.add(1), amount0Desired: 0, amount1Desired: 0,
        amount0Min: 0, amount1Min: 0, deadline: PRECISION
      })).to.be.reverted;
    });

    it('revert expired', async () => {
      await initLiquidity(user, tokenA.address, tokenB.address);
      await expect(positionManager.connect(user).addLiquidity({
        tokenId: 1, amount0Desired: 0, amount1Desired: 0,
        amount0Min: 0, amount1Min: 0, deadline: 0
      })).to.be.revertedWith('ProAMM: Expired');
    });

    it('revert price slippage', async () => {
      await initLiquidity(user, tokenA.address, tokenB.address);
      await expect(positionManager.connect(user).addLiquidity({
        tokenId: 1, amount0Desired: BN.from(100000), amount1Desired: BN.from(100000),
        amount0Min: BN.from(100001), amount1Min: 0, deadline: PRECISION
      })).to.be.revertedWith('LiquidityHelper: price slippage check');
      await expect(positionManager.connect(user).addLiquidity({
        tokenId: 1, amount0Desired: BN.from(100000), amount1Desired: BN.from(100000),
        amount0Min: 0, amount1Min: BN.from(100001), deadline: PRECISION
      })).to.be.revertedWith('LiquidityHelper: price slippage check');
    });

    it('add liquidity with tokens - no new fees', async () => {
      await initLiquidity(user, tokenA.address, tokenB.address);
      await initLiquidity(other, tokenA.address, tokenB.address);
      let pool = await factory.getPool(tokenA.address, tokenB.address, swapFeeBpsArray[0]);
      let poolContract = (await ethers.getContractAt('ProAMMPool', pool)) as ProAMMPool;

      let users = [user, other];
      let tokenIds = [nextTokenId, nextTokenId.add(1)];
      let gasUsed = BN.from(0);
      let numRuns = 5;

      for (let i = 0; i < numRuns; i++) {
        let sender = users[i % 2];
        let amount0 = BN.from(100000 * (i + 1));
        let amount1 = BN.from(120000 * (i + 1));
        let tokenId = tokenIds[i % 2];

        let userData = await positionManager.positions(tokenId);
        let poolData = await poolContract.getPositions(positionManager.address, tickLower, tickUpper);

        let userBalBefore = await getBalances(sender.address, [tokenA.address, tokenB.address]);
        let poolBalBefore = await getBalances(pool, [tokenA.address, tokenB.address]);
        let rTokenBalBefore = await getBalances(positionManager.address, [userData.info.rToken]);

        let tx = await positionManager.connect(sender).addLiquidity({
          tokenId: tokenId, amount0Desired: amount0, amount1Desired: amount1,
          amount0Min: 0, amount1Min: 0, deadline: PRECISION
        });
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);

        // verify balance
        let userBalAfter = await getBalances(sender.address, [tokenA.address, tokenB.address]);
        let poolBalAfter = await getBalances(pool, [tokenA.address, tokenB.address]);
        expect(poolBalAfter.tokenBalances[0].sub(poolBalBefore.tokenBalances[0])).to.be.eq(
          userBalBefore.tokenBalances[0].sub(userBalAfter.tokenBalances[0])
        );
        expect(poolBalAfter.tokenBalances[1].sub(poolBalBefore.tokenBalances[1])).to.be.eq(
          userBalBefore.tokenBalances[1].sub(userBalAfter.tokenBalances[1])
        );

        // verify liquidity and position
        let userNewData = await positionManager.positions(tokenId);
        let newPoolData = await poolContract.getPositions(positionManager.address, tickLower, tickUpper);
        let rTokenBalAfter = await getBalances(positionManager.address, [userData.info.rToken]);

        // no new rToken in the contract
        expect(rTokenBalAfter.tokenBalances[0].sub(rTokenBalBefore.tokenBalances[0])).to.be.eq(0);
        // should earn no fee as no swap
        expect(userNewData.pos.rTokenOwed).to.be.eq(0);
        expect(newPoolData.feeGrowthInsideLast).to.be.eq(userNewData.pos.feeGrowthInsideLast); // should update to latest fee growth
        // same amount liquidity increases
        expect(newPoolData.liquidity.sub(poolData.liquidity)).to.be.eq(
          userNewData.pos.liquidity.sub(userData.pos.liquidity)
        );
      }
      if (showTxGasUsed) {
        logMessage(`Average gas use for add liquidity - no new fees: ${gasUsed.div(numRuns).toString()}`);
      }
    });

    it('add liquidity with tokens - has new fees', async () => {
      await initLiquidity(user, tokenA.address, tokenB.address);
      await initLiquidity(other, tokenA.address, tokenB.address);

      let pool = await factory.getPool(tokenA.address, tokenB.address, swapFeeBpsArray[0]);
      let poolContract = (await ethers.getContractAt('ProAMMPool', pool)) as ProAMMPool;

      let users = [user, other];
      let tokenIds = [nextTokenId, nextTokenId.add(1)];
      let gasUsed = BN.from(0);
      let numRuns = 5;

      for (let i = 0; i < numRuns; i++) {
        let sender = users[i % 2];
        let amount0 = BN.from(100000 * (i + 1));
        let amount1 = BN.from(120000 * (i + 1));
        let tokenId = tokenIds[i % 2];

        let userData = await positionManager.positions(tokenId);
        let poolData = await poolContract.getPositions(positionManager.address, tickLower, tickUpper);
        let rTokenBalBefore = await getBalances(positionManager.address, [userData.info.rToken]);

        // made some swaps to get fees
        for (let j = 0; j < 5; j++) {
          let amount = BN.from(100000 * (j + 1));
          await swapExactInput(tokenA.address, tokenB.address, swapFeeBpsArray[0], amount);
          amount = BN.from(150000 * (j + 1));
          await swapExactInput(tokenB.address, tokenA.address, swapFeeBpsArray[0], amount);
        }

        let userBalBefore = await getBalances(sender.address, [tokenA.address, tokenB.address]);
        let poolBalBefore = await getBalances(pool, [tokenA.address, tokenB.address]);

        let tx = await positionManager.connect(sender).addLiquidity({
          tokenId: tokenId, amount0Desired: amount0, amount1Desired: amount1,
          amount0Min: 0, amount1Min: 0, deadline: PRECISION
        });
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);

        // verify balance
        let userBalAfter = await getBalances(sender.address, [tokenA.address, tokenB.address]);
        let poolBalAfter = await getBalances(pool, [tokenA.address, tokenB.address]);
        expect(poolBalAfter.tokenBalances[0].sub(poolBalBefore.tokenBalances[0])).to.be.eq(
          userBalBefore.tokenBalances[0].sub(userBalAfter.tokenBalances[0])
        );
        expect(poolBalAfter.tokenBalances[1].sub(poolBalBefore.tokenBalances[1])).to.be.eq(
          userBalBefore.tokenBalances[1].sub(userBalAfter.tokenBalances[1])
        );

        // verify liquidity and position
        let userNewData = await positionManager.positions(tokenId);
        let newPoolData = await poolContract.getPositions(positionManager.address, tickLower, tickUpper);

        // additional rToken owed = user_liquidity * (pool_last_fee_growth - user_last_fee_growth) / 2**96
        let additionalRTokenOwed = userData.pos.liquidity.mul(
          userNewData.pos.feeGrowthInsideLast.sub(userData.pos.feeGrowthInsideLast)
        );
        additionalRTokenOwed = additionalRTokenOwed.div(TWO_POW_96);

        let rTokenBalAfter = await getBalances(positionManager.address, [userData.info.rToken]);

        // additional rToken = liquidity * (new_fee_growth - last_fee_growth) / 2**96
        let additionRToken = poolData.liquidity.mul(newPoolData.feeGrowthInsideLast.sub(poolData.feeGrowthInsideLast));
        additionRToken = additionRToken.div(TWO_POW_96);
        expect(additionRToken).to.be.eq(rTokenBalAfter.tokenBalances[0].sub(rTokenBalBefore.tokenBalances[0]));

        // should update rToken owed and latest fee growth
        expect(userNewData.pos.rTokenOwed).to.be.eq(
          userData.pos.rTokenOwed.add(additionalRTokenOwed)
        );
        expect(newPoolData.feeGrowthInsideLast).to.be.eq(userNewData.pos.feeGrowthInsideLast);
        // same amount liquidity increases
        expect(newPoolData.liquidity.sub(poolData.liquidity)).to.be.eq(
          userNewData.pos.liquidity.sub(userData.pos.liquidity)
        );
      }
      if (showTxGasUsed) {
        logMessage(`Average gas use for add liquidity - has new fees: ${gasUsed.div(numRuns).toString()}`);
      }
    });
  });

  describe(`#remove liquidity`, async () => {
    before('create and unlock pools', async () => {
      await revertToSnapshot(initialSnapshotId);
      await createAndUnlockPools();
      snapshotId = await snapshot();
    });

    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
      nextTokenId = await positionManager.nextTokenId();
    });

    it('revert insufficient liquidity', async () => {
      // non-exist token
      await expect(positionManager.connect(user).removeLiquidity({
        tokenId: 0, liquidity: 1, amount0Min: 0, amount1Min: 0, deadline: PRECISION
      })).to.be.reverted;
      await initLiquidity(user, tokenA.address, tokenB.address);
      let userData = await positionManager.positions(nextTokenId);
      await expect(positionManager.connect(user).removeLiquidity({
        tokenId: nextTokenId, liquidity: userData.pos.liquidity.add(1),
        amount0Min: 0, amount1Min: 0, deadline: PRECISION
      })).to.be.revertedWith('Insufficient liquidity');
    });

    it('revert expired', async () => {
      await initLiquidity(user, tokenA.address, tokenB.address);
      await expect(positionManager.connect(user).removeLiquidity({
        tokenId: nextTokenId, liquidity: 1, amount0Min: 0, amount1Min: 0, deadline: 0
      })).to.be.revertedWith('ProAMM: Expired');
    });

    it('revert unauthorized', async () => {
      await initLiquidity(user, tokenA.address, tokenB.address);
      await expect(positionManager.connect(other).removeLiquidity({
        tokenId: nextTokenId, liquidity: 1, amount0Min: 0, amount1Min: 0, deadline: PRECISION
      })).to.be.revertedWith('Not approved');
    });

    it('revert price slippage', async () => {
      await initLiquidity(user, tokenA.address, tokenB.address);
      await expect(positionManager.connect(user).removeLiquidity({
        tokenId: nextTokenId, liquidity: 10, amount0Min: PRECISION, amount1Min: 0, deadline: PRECISION
      })).to.be.revertedWith('Low return amounts');
      await expect(positionManager.connect(user).removeLiquidity({
        tokenId: nextTokenId, liquidity: 10, amount0Min: 0, amount1Min: PRECISION, deadline: PRECISION
      })).to.be.revertedWith('Low return amounts');
    });

    it('remove liquidity with tokens - no new fees', async () => {
      await initLiquidity(user, tokenA.address, tokenB.address);
      await initLiquidity(other, tokenA.address, tokenB.address);

      let pool = await factory.getPool(tokenA.address, tokenB.address, swapFeeBpsArray[0]);
      let poolContract = (await ethers.getContractAt('ProAMMPool', pool)) as ProAMMPool;

      let users = [user, other];
      let tokenIds = [nextTokenId, nextTokenId.add(1)];
      let gasUsed = BN.from(0);
      let numRuns = 5;

      for (let i = 0; i < numRuns; i++) {
        let sender = users[i % 2];
        let tokenId = tokenIds[i % 2];

        let userData = await positionManager.positions(tokenId);
        let poolData = await poolContract.getPositions(positionManager.address, tickLower, tickUpper);

        let userBalBefore = await getBalances(sender.address, [tokenA.address, tokenB.address]);
        let poolBalBefore = await getBalances(pool, [tokenA.address, tokenB.address]);
        let rTokenBalBefore = await getBalances(positionManager.address, [userData.info.rToken]);

        let liquidity = BN.from((i + 1) * 100);
        let tx = await removeLiquidity(tokenA.address, tokenB.address, sender, tokenId, liquidity);
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);

        // verify balance
        let userBalAfter = await getBalances(sender.address, [tokenA.address, tokenB.address]);
        let poolBalAfter = await getBalances(pool, [tokenA.address, tokenB.address]);
        expect(poolBalBefore.tokenBalances[0].sub(poolBalAfter.tokenBalances[0])).to.be.eq(
          userBalAfter.tokenBalances[0].sub(userBalBefore.tokenBalances[0])
        );
        expect(poolBalBefore.tokenBalances[1].sub(poolBalAfter.tokenBalances[1])).to.be.eq(
          userBalAfter.tokenBalances[1].sub(userBalBefore.tokenBalances[1])
        );

        // verify liquidity and position
        let userNewData = await positionManager.positions(tokenId);
        let newPoolData = await poolContract.getPositions(positionManager.address, tickLower, tickUpper);
        let rTokenBalAfter = await getBalances(positionManager.address, [userData.info.rToken]);

        // no rToken in the contract
        expect(rTokenBalAfter.tokenBalances[0].sub(rTokenBalBefore.tokenBalances[0])).to.be.eq(0);
        expect(userNewData.pos.rTokenOwed).to.be.eq(0); // should earn no fee as no swap
        expect(newPoolData.feeGrowthInsideLast).to.be.eq(userNewData.pos.feeGrowthInsideLast); // should update to latest fee growth
        // same amount liquidity decreases
        expect(liquidity).to.be.eq(userData.pos.liquidity.sub(userNewData.pos.liquidity));
        expect(liquidity).to.be.eq(poolData.liquidity.sub(newPoolData.liquidity));
      }
      if (showTxGasUsed) {
        logMessage(`Average gas use for remove liquidity - no new fees: ${gasUsed.div(numRuns).toString()}`);
      }
    });

    it('remove liquidity with tokens - has new fees', async () => {
      await initLiquidity(user, tokenA.address, tokenB.address);
      await initLiquidity(other, tokenA.address, tokenB.address);

      let pool = await factory.getPool(tokenA.address, tokenB.address, swapFeeBpsArray[0]);
      let poolContract = (await ethers.getContractAt('ProAMMPool', pool)) as ProAMMPool;

      let users = [user, other];
      let tokenIds = [nextTokenId, nextTokenId.add(1)];
      let gasUsed = BN.from(0);
      let numRuns = 5;

      for (let i = 0; i < numRuns; i++) {
        let sender = users[i % 2];
        let tokenId = tokenIds[i % 2];

        let userData = await positionManager.positions(tokenId);
        let poolData = await poolContract.getPositions(positionManager.address, tickLower, tickUpper);
        let rTokenBalBefore = await getBalances(positionManager.address, [userData.info.rToken]);

        // made some swaps to get fees
        for (let j = 0; j < 5; j++) {
          let amount = BN.from(100000 * (j + 1));
          await swapExactInput(tokenA.address, tokenB.address, swapFeeBpsArray[0], amount);
          amount = BN.from(150000 * (j + 1));
          await swapExactInput(tokenB.address, tokenA.address, swapFeeBpsArray[0], amount);
        }

        let userBalBefore = await getBalances(sender.address, [tokenA.address, tokenB.address]);
        let poolBalBefore = await getBalances(pool, [tokenA.address, tokenB.address]);

        let liquidity = BN.from((i + 1) * 100);
        let tx = await removeLiquidity(tokenA.address, tokenB.address, sender, tokenId, liquidity);
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);

        // verify balance
        let userBalAfter = await getBalances(sender.address, [tokenA.address, tokenB.address]);
        let poolBalAfter = await getBalances(pool, [tokenA.address, tokenB.address]);
        expect(poolBalBefore.tokenBalances[0].sub(poolBalAfter.tokenBalances[0])).to.be.eq(
          userBalAfter.tokenBalances[0].sub(userBalBefore.tokenBalances[0])
        );
        expect(poolBalBefore.tokenBalances[1].sub(poolBalAfter.tokenBalances[1])).to.be.eq(
          userBalAfter.tokenBalances[1].sub(userBalBefore.tokenBalances[1])
        );

        // verify liquidity and position
        let userNewData = await positionManager.positions(tokenId);
        let newPoolData = await poolContract.getPositions(positionManager.address, tickLower, tickUpper);

        // additional rToken owed = user_liquidity * (pool_last_fee_growth - user_last_fee_growth) / 2**96
        let additionalRTokenOwed = userData.pos.liquidity.mul(
          userNewData.pos.feeGrowthInsideLast.sub(userData.pos.feeGrowthInsideLast)
        );
        additionalRTokenOwed = additionalRTokenOwed.div(TWO_POW_96);

        let rTokenBalAfter = await getBalances(positionManager.address, [userData.info.rToken]);

        // additional rToken = liquidity * (new_fee_growth - last_fee_growth) / 2**96
        let additionRToken = poolData.liquidity.mul(newPoolData.feeGrowthInsideLast.sub(poolData.feeGrowthInsideLast));
        additionRToken = additionRToken.div(TWO_POW_96);
        expect(additionRToken).to.be.eq(rTokenBalAfter.tokenBalances[0].sub(rTokenBalBefore.tokenBalances[0]));

        // should update rToken owed and latest fee growth
        expect(userNewData.pos.rTokenOwed).to.be.eq(
          userData.pos.rTokenOwed.add(additionalRTokenOwed)
        );
        expect(newPoolData.feeGrowthInsideLast).to.be.eq(userNewData.pos.feeGrowthInsideLast);
        // same amount liquidity decreases
        expect(liquidity).to.be.eq(userData.pos.liquidity.sub(userNewData.pos.liquidity));
        expect(liquidity).to.be.eq(poolData.liquidity.sub(newPoolData.liquidity));
      }
      if (showTxGasUsed) {
        logMessage(`Average gas use for add liquidity - has new fees: ${gasUsed.div(numRuns).toString()}`);
      }
    });

    it('remove liquidity, no collecting tokens', async () => {
      await initLiquidity(user, tokenA.address, tokenB.address);

      let pool = await factory.getPool(tokenA.address, tokenB.address, swapFeeBpsArray[0]);
      let poolBalBefore = await getBalances(pool, [tokenA.address, tokenB.address]);

      // remove liquidity without calling transfer tokens
      await positionManager.connect(user).removeLiquidity({
        tokenId: nextTokenId, liquidity: BN.from(1000),
        amount0Min: 0, amount1Min: 0, deadline: PRECISION
      });

      let poolBalAfter = await getBalances(pool, [tokenA.address, tokenB.address]);
      expect(poolBalBefore.tokenBalances[0].sub(poolBalAfter.tokenBalances[0])).to.be.eq(
        await tokenA.balanceOf(positionManager.address)
      );
      expect(poolBalBefore.tokenBalances[1].sub(poolBalAfter.tokenBalances[1])).to.be.eq(
        await tokenB.balanceOf(positionManager.address)
      );
    });
  });

  describe(`#burn rtoken`, async () => {
    before('create and unlock pools', async () => {
      await revertToSnapshot(initialSnapshotId);
      await createAndUnlockPools();
      snapshotId = await snapshot();
    });

    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
      nextTokenId = await positionManager.nextTokenId();
    });

    it('revert unauthorized', async () => {
      await initLiquidity(user, tokenA.address, tokenB.address);
      await expect(positionManager.connect(other).burnRTokens({
        tokenId: nextTokenId, amount0Min: 0, amount1Min: 0, deadline: PRECISION
      })).to.be.revertedWith('Not approved');
    });

    it('revert expired', async () => {
      await initLiquidity(user, tokenA.address, tokenB.address);
      await expect(positionManager.connect(user).burnRTokens({
        tokenId: nextTokenId, amount0Min: 0, amount1Min: 0, deadline: 0
      })).to.be.revertedWith('ProAMM: Expired');
    });

    it('revert no rToken to burn', async () => {
      await initLiquidity(user, tokenA.address, tokenB.address);
      await expect(positionManager.connect(user).burnRTokens({
        tokenId: nextTokenId, amount0Min: 0, amount1Min: 0, deadline: PRECISION
      })).to.be.revertedWith('No rToken to burn');
    });

    it('revert price slippage', async () => {
      await initLiquidity(user, tokenA.address, tokenB.address);
      for (let i = 0; i < 5; i++) {
        await swapExactInput(tokenA.address, tokenB.address, swapFeeBpsArray[0], BN.from(100000));
        await swapExactInput(tokenB.address, tokenA.address, swapFeeBpsArray[0], BN.from(200000));
      }
      // simple remove liq to update the rtokens
      await removeLiquidity(tokenA.address, tokenB.address, user, nextTokenId, BN.from(10));

      await expect(positionManager.connect(user).burnRTokens({
        tokenId: nextTokenId, amount0Min: PRECISION, amount1Min: 0, deadline: PRECISION
      })).to.be.revertedWith('Low return amounts');
      await expect(positionManager.connect(user).burnRTokens({
        tokenId: nextTokenId, amount0Min: 0, amount1Min: PRECISION, deadline: PRECISION
      })).to.be.revertedWith('Low return amounts');
    });

    it('burn rToken and update states', async () => {
      await initLiquidity(user, tokenA.address, tokenB.address);
      await initLiquidity(other, tokenA.address, tokenB.address);

      let pool = await factory.getPool(tokenA.address, tokenB.address, swapFeeBpsArray[0]);

      let users = [user, other];
      let tokenIds = [nextTokenId, nextTokenId.add(1)];
      let gasUsed = BN.from(0);
      let numRuns = 5;

      for (let i = 0; i < numRuns; i++) {
        let sender = users[i % 2];
        let tokenId = tokenIds[i % 2];

        // made some swaps to get fees
        for (let j = 0; j < 5; j++) {
          await swapExactInput(tokenA.address, tokenB.address, swapFeeBpsArray[0], BN.from(100000 * (j + 1)));
          await swapExactInput(tokenB.address, tokenA.address, swapFeeBpsArray[0], BN.from(150000 * (j + 1)));
        }

        // remove liquidity to update the latest rToken states
        await removeLiquidity(tokenA.address, tokenB.address, sender, tokenId, BN.from(100));

        let userData = await positionManager.positions(tokenId);
        let userBalBefore = await getBalances(sender.address, [tokenA.address, tokenB.address]);
        let poolBalBefore = await getBalances(pool, [tokenA.address, tokenB.address]);
        let rTokenBefore = await getBalances(positionManager.address, [userData.info.rToken]);

        // call to burn rTokens
        let tx = await burnRTokens(tokenA.address, tokenB.address, sender, tokenId);
        gasUsed = gasUsed.add((await tx.wait()).gasUsed);

        // verify user has received tokens
        let userBalAfter = await getBalances(sender.address, [tokenA.address, tokenB.address]);
        let poolBalAfter = await getBalances(pool, [tokenA.address, tokenB.address]);
        expect(poolBalBefore.tokenBalances[0].sub(poolBalAfter.tokenBalances[0])).to.be.eq(
          userBalAfter.tokenBalances[0].sub(userBalBefore.tokenBalances[0])
        );
        expect(poolBalBefore.tokenBalances[1].sub(poolBalAfter.tokenBalances[1])).to.be.eq(
          userBalAfter.tokenBalances[1].sub(userBalBefore.tokenBalances[1])
        );

        // verify liquidity and position, should have burnt all rTokenOwed
        let userNewData = await positionManager.positions(tokenId);
        expect(userNewData.pos.rTokenOwed).to.be.eq(0);
        let rTokenBalAfter = await getBalances(positionManager.address, [userData.info.rToken]);
        expect(userData.pos.rTokenOwed).to.be.eq(
          rTokenBefore.tokenBalances[0].sub(rTokenBalAfter.tokenBalances[0])
        );
      }
      if (showTxGasUsed) {
        logMessage(`Average gas use for add liquidity - has new fees: ${gasUsed.div(numRuns).toString()}`);
      }
    });
  });

  describe(`#burn token`, async () => {
    before('create and unlock pools', async () => {
      await revertToSnapshot(initialSnapshotId);
      await createAndUnlockPools();
      snapshotId = await snapshot();
    });

    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
      nextTokenId = await positionManager.nextTokenId();
    });

    it('revert unauthorized', async () => {
      await initLiquidity(user, tokenA.address, tokenB.address);
      await expect(positionManager.connect(other).burn(nextTokenId)).to.be.revertedWith('Not approved');
    });

    it('revert liquidity > 0', async () => {
      await initLiquidity(user, tokenA.address, tokenB.address);
      await expect(positionManager.connect(user).burn(nextTokenId)).to.be.revertedWith('Should remove liquidity first');
    });

    it('revert rTokenOwed > 0', async () => {
      await initLiquidity(user, tokenA.address, tokenB.address);
      for (let i = 0; i < 5; i++) {
        await swapExactInput(tokenA.address, tokenB.address, swapFeeBpsArray[0], BN.from(100000));
        await swapExactInput(tokenB.address, tokenA.address, swapFeeBpsArray[0], BN.from(200000));
      }
      let userData = await positionManager.positions(nextTokenId);
      await removeLiquidity(tokenA.address, tokenB.address, user, nextTokenId, userData.pos.liquidity);
      await expect(positionManager.connect(user).burn(nextTokenId)).to.be.revertedWith('Should burn rToken first');
    });

    it('burn rToken and update states', async () => {
      await initLiquidity(user, tokenA.address, tokenB.address);
      for (let i = 0; i < 5; i++) {
        await swapExactInput(tokenA.address, tokenB.address, swapFeeBpsArray[0], BN.from(100000));
        await swapExactInput(tokenB.address, tokenA.address, swapFeeBpsArray[0], BN.from(200000));
      }
      let userData = await positionManager.positions(nextTokenId);
      await removeLiquidity(tokenA.address, tokenB.address, user, nextTokenId, userData.pos.liquidity);
      await burnRTokens(tokenA.address, tokenB.address, user, nextTokenId);
      let tx = await positionManager.burn(nextTokenId);
      await expect(positionManager.ownerOf(nextTokenId)).to.be.revertedWith("");
      if (showTxGasUsed) {
        logMessage(`Average gas use to burn: ${(await tx.wait()).gasUsed.toString()}`);
      }
    });
  });

  describe(`#transfer all tokens`, async () => {
    before('create and unlock pools', async () => {
      await revertToSnapshot(initialSnapshotId);
      await createAndUnlockPools();
      snapshotId = await snapshot();
    });

    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
      nextTokenId = await positionManager.nextTokenId();
    });

    it('revert not enough token', async () => {
      await expect(positionManager.connect(user).transferAllTokens(tokenA.address, PRECISION, user.address))
        .to.be.revertedWith('Insufficient token');
    });

    it('revert can not transfer rToken', async () => {
      await initLiquidity(user, tokenA.address, tokenB.address);
      let userData = await positionManager.positions(nextTokenId);
      let rToken = userData.info.rToken;
      await expect(positionManager.connect(user).transferAllTokens(rToken, PRECISION, user.address))
        .to.be.revertedWith('Can not transfer rToken');
    });

    it('transfer all tokens to recipient', async () => {
      await tokenA.transfer(positionManager.address, PRECISION);
      let balance = await tokenA.balanceOf(positionManager.address);
      let recipientBal = await tokenA.balanceOf(other.address);
      await positionManager.connect(user).transferAllTokens(tokenA.address, 0, other.address);
      expect((await tokenA.balanceOf(other.address)).sub(recipientBal)).to.be.eq(balance);
      expect(await tokenA.balanceOf(positionManager.address)).to.be.eq(0);
    });
  });

  describe(`#approve`, async () => {
    before('create and unlock pools', async () => {
      await revertToSnapshot(initialSnapshotId);
      await createAndUnlockPools();
      snapshotId = await snapshot();
    });

    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
      nextTokenId = await positionManager.nextTokenId();
    });

    it('revert token not exist', async () => {
      await expect(positionManager.getApproved(nextTokenId.add(1)))
        .to.be.revertedWith('ERC721: approved query for nonexistent token');
    });

    it('approve and check', async () => {
      await initLiquidity(user, tokenA.address, tokenB.address);
      expect(await positionManager.getApproved(nextTokenId)).to.be.eq(ZERO_ADDRESS);
      await positionManager.approve(other.address, nextTokenId);
      expect(await positionManager.getApproved(nextTokenId)).to.be.eq(other.address);
      await swapExactInput(tokenA.address, tokenB.address, swapFeeBpsArray[0], BN.from(1000000));
      // now `other` can remove liquidity, burnRTokens, and burn nft token
      let userData = await positionManager.positions(nextTokenId);
      await removeLiquidity(tokenA.address, tokenB.address, other, nextTokenId, userData.pos.liquidity);
      await burnRTokens(tokenA.address, tokenB.address, other, nextTokenId);
      await positionManager.connect(other).burn(nextTokenId);
    });
  });

  describe(`#tokenUri`, async () => {
    before('create and unlock pools', async () => {
      await revertToSnapshot(initialSnapshotId);
      await createAndUnlockPools();
      snapshotId = await snapshot();
    });

    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
      nextTokenId = await positionManager.nextTokenId();
    });

    it('revert token not exist', async () => {
      await expect(positionManager.tokenURI(nextTokenId.add(1)))
        .to.be.revertedWith('Nonexistent token');
    });

    it('check data', async () => {
      await initLiquidity(user, tokenA.address, tokenB.address);
      expect(await positionManager.tokenURI(nextTokenId)).to.be.eq('');
      await tokenDescriptor.setTokenUri('new token uri');
      expect(await positionManager.tokenURI(nextTokenId)).to.be.eq('new token uri');
    });
  });

  describe(`#permit-erc721`, async () => {
    before('create and unlock pools', async () => {
      await revertToSnapshot(initialSnapshotId);
      await createAndUnlockPools();
      snapshotId = await snapshot();
    });

    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
      nextTokenId = await positionManager.nextTokenId();
      await initLiquidity(user, tokenA.address, tokenB.address);
    });

    it('revert expired', async () => {
      const { v, r, s } = await getEC721PermitSignature(user, positionManager, other.address, nextTokenId, PRECISION);
      await expect(positionManager.connect(user).permit(other.address, nextTokenId, 1, v, r, s))
        .to.be.revertedWith('ProAMM: Expired');
    });

    it('revert call twice with the same signature', async () => {
      const { v, r, s } = await getEC721PermitSignature(user, positionManager, other.address, nextTokenId, PRECISION);
      await positionManager.connect(user).permit(other.address, nextTokenId, PRECISION, v, r, s);
      await expect(positionManager.connect(user).permit(other.address, nextTokenId, PRECISION, v, r, s))
        .to.be.reverted;
    });

    it('revert invalid signature', async () => {
      await initLiquidity(user, tokenA.address, tokenB.address);
      const { v, r, s } = await getEC721PermitSignature(user, positionManager, other.address, nextTokenId, PRECISION);
      await expect(positionManager.permit(other.address, nextTokenId, PRECISION, v + 3, r, s))
        .to.be.revertedWith('Invalid signature');
      await expect(positionManager.connect(user).permit(other.address, nextTokenId.add(1), PRECISION, v, r, s))
        .to.be.reverted;
      await expect(positionManager.connect(user).permit(other.address, nextTokenId, PRECISION.sub(1), v, r, s))
      .to.be.reverted;
    });

    it('revert signature not from owner', async () => {
      const { v, r, s } = await getEC721PermitSignature(other, positionManager, admin.address, nextTokenId, PRECISION);
      await expect(positionManager.connect(user).permit(admin.address, nextTokenId, PRECISION, v, r, s))
        .to.be.revertedWith('Unauthorized');
    });

    it('revert approve to current owner', async () => {
      const { v, r, s } = await getEC721PermitSignature(user, positionManager, user.address, nextTokenId, PRECISION);
      await expect(positionManager.connect(user).permit(user.address, nextTokenId, PRECISION, v, r, s))
        .to.be.revertedWith('ERC721Permit: approval to current owner');
    });

    it('should change the operator of the position and increase the nonce', async () => {
      const { v, r, s } = await getEC721PermitSignature(user, positionManager, other.address, nextTokenId, PRECISION);
      await positionManager.connect(user).permit(other.address, nextTokenId, PRECISION, v, r, s);
      expect((await positionManager.positions(nextTokenId)).pos.nonce).to.eq(1)
      expect((await positionManager.positions(nextTokenId)).pos.operator).to.eq(other.address);
      expect(await positionManager.getApproved(nextTokenId)).to.be.eq(other.address);
    });
  });
});

function logMessage(message: string) {
  console.log(`         ${message}`);
}

function sortTokens(token0: string, token1: string) {
  return token0 < token1 ? [token0, token1] : [token1, token0];
}
