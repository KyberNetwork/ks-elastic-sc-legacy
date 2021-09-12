import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {Wallet, BigNumber, ContractTransaction} from 'ethers';
import {BN, PRECISION, ZERO_ADDRESS, MIN_SQRT_RATIO, ONE, TWO, MIN_LIQUIDITY, MAX_SQRT_RATIO, TWO_POW_96, ZERO} from '../helpers/helper';
import {encodePriceSqrt, getPriceFromTick, getNearestSpacedTickAtPrice, getPositionKey} from '../helpers/utils';
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
  const [user, admin, other] = waffle.provider.getWallets();

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

  const createAndUnlockPools = async () => {
    let initialPrice = encodePriceSqrt(1, 2);
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
      await createAndUnlockPools();
      snapshotId = await snapshot();
    });

    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
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
        tickLower: -tickSpacingArray[0], tickUpper: tickSpacingArray[0],
        amount0Desired: BN.from(1000000), amount1Desired: BN.from(1000000),
        amount0Min: PRECISION, amount1Min: 0, recipient: user.address, deadline: PRECISION
      })).to.be.revertedWith('LiquidityHelper: price slippage check');
      await expect(positionManager.connect(user).mint({
        token0: token0, token1: token1, fee: swapFeeBpsArray[0],
        tickLower: -tickSpacingArray[0], tickUpper: tickSpacingArray[0],
        amount0Desired: BN.from(1000000), amount1Desired: BN.from(1000000),
        amount0Min: 0, amount1Min: PRECISION, recipient: user.address, deadline: PRECISION
      })).to.be.revertedWith('LiquidityHelper: price slippage check');
    });

    it('mint & create new token', async () => {
      let [token0, token1] = sortTokens(tokenA.address, tokenB.address);

      let recipients = [user.address, other.address];
      let gasUsed = BN.from(0);

      let nextTokenId = 1;
      let poolId = 1;

      let poolAddress = await factory.getPool(token0, token1, swapFeeBpsArray[0]);

      for (let i = 0; i < recipients.length; i++) {

        let tickLower = tickSpacingArray[0] * (i + 1) * -10;
        let tickUpper = tickSpacingArray[0] * (i + 1) * 10;

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

        // verify user should be the owner of nextTokenId
        expect(await positionManager.balanceOf(recipients[i])).to.be.eq(1);
        expect(await positionManager.tokenOfOwnerByIndex(recipients[i], 0)).to.be.eq(nextTokenId);
        expect(await positionManager.ownerOf(nextTokenId)).to.be.eq(recipients[i]);

        // verify position and pool info in PositionManager
        let pool = (await ethers.getContractAt('ProAMMPool', poolAddress) as ProAMMPool);
        const { pos, info } = await positionManager.positions(nextTokenId);
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
        let positionKey = getPositionKey(positionManager.address, pos.tickLower, pos.tickUpper);
        const { liquidity, feeGrowthInsideLast } = await pool.positions(positionKey);
        expect(liquidity).to.be.eq(pos.liquidity);
        expect(feeGrowthInsideLast).to.be.eq(pos.feeGrowthInsideLast);

        nextTokenId++;
      }
      if (showTxGasUsed) {
        logMessage(`Average mint gas: ${(gasUsed.div(BN.from(recipients.length))).toString()}`);
      }
    });

    it('mint with eth using multicall', async () => {
      let [token0, token1] = sortTokens(weth.address, tokenB.address);

      let recipients = [user.address, other.address];
      let gasUsed = BN.from(0);

      let nextTokenId = 1;
      let poolId = 1;

      let poolAddress = await factory.getPool(token0, token1, swapFeeBpsArray[0]);

      for (let i = 0; i < recipients.length; i++) {

        let tickLower = tickSpacingArray[0] * (i + 1) * -10;
        let tickUpper = tickSpacingArray[0] * (i + 1) * 10;

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
        multicallData.push(positionManager.interface.encodeFunctionData('refundETH', []));
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

        // verify user should be the owner of nextTokenId
        expect(await positionManager.balanceOf(recipients[i])).to.be.eq(1);
        expect(await positionManager.tokenOfOwnerByIndex(recipients[i], 0)).to.be.eq(nextTokenId);
        expect(await positionManager.ownerOf(nextTokenId)).to.be.eq(recipients[i]);

        // verify position and pool info in PositionManager
        let pool = (await ethers.getContractAt('ProAMMPool', poolAddress) as ProAMMPool);
        const { pos, info } = await positionManager.positions(nextTokenId);
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
        let positionKey = getPositionKey(positionManager.address, pos.tickLower, pos.tickUpper);
        const { liquidity, feeGrowthInsideLast } = await pool.positions(positionKey);
        expect(liquidity).to.be.eq(pos.liquidity);
        expect(feeGrowthInsideLast).to.be.eq(pos.feeGrowthInsideLast);

        nextTokenId++;
      }
      if (showTxGasUsed) {
        logMessage(`Average mint gas: ${(gasUsed.div(BN.from(recipients.length))).toString()}`);
      }
    });
  });
});

function logMessage(message: string) {
  console.log(`         ${message}`);
}

function sortTokens(token0: string, token1: string) {
  return token0 < token1 ? [token0, token1] : [token1, token0];
}
