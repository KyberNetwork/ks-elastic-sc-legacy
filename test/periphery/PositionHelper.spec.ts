import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {Wallet, BigNumber, ContractTransaction} from 'ethers';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {
  MockToken,
  MockToken__factory,
  MockWeth,
  MockWeth__factory,
  BasePositionManager,
  BasePositionManager__factory,
  Router__factory,
  Router,
  Factory,
  Pool,
  MockTokenPositionDescriptor,
  MockTokenPositionDescriptor__factory,
  PositionHelper,
  PositionHelper__factory,
} from '../../typechain';

import {deployFactory, getTicksPrevious} from '../helpers/setup';
import {snapshot, revertToSnapshot} from '../helpers/hardhat';
import {BN, PRECISION, ZERO_ADDRESS, TWO_POW_96, MIN_TICK, ZERO} from '../helpers/helper';
import {encodePriceSqrt, sortTokens, orderTokens} from '../helpers/utils';
import getEC721PermitSignature from '../helpers/getEC721PermitSignature';

const txGasPrice = BN.from(100).mul(BN.from(10).pow(9));
const showTxGasUsed = true;

const BIG_AMOUNT = BN.from(2).pow(255);

let Token: MockToken__factory;
let PositionManager: BasePositionManager__factory;
let PositionHelper: PositionHelper__factory;
let factory: Factory;
let positionManager: BasePositionManager;
let positionHelper: PositionHelper;
let router: Router;
let tokenDescriptor: MockTokenPositionDescriptor;
let tokenA: MockToken;
let tokenB: MockToken;
let weth: MockWeth;
let nextTokenId: BigNumber;
let swapFeeUnitsArray = [50, 300];
let tickDistanceArray = [10, 60];
let ticksPrevious: [BigNumber, BigNumber] = [MIN_TICK, MIN_TICK];
let vestingPeriod = 0;
let initialPrice: BigNumber;
let snapshotId: any;
let initialSnapshotId: any;

let getBalances: (
  who: string,
  tokens: string[]
) => Promise<{
  tokenBalances: BigNumber[];
}>;

describe('PositionHelper', () => {
  const [user, admin, other] = waffle.provider.getWallets();
  const tickLower = -100 * tickDistanceArray[0];
  const tickUpper = 100 * tickDistanceArray[0];

  before('factory, token and callback setup', async () => {
    Token = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    PositionHelper = (await ethers.getContractFactory('PositionHelper')) as PositionHelper__factory;
    tokenA = await Token.deploy('USDC', 'USDC', BN.from(100000000000).mul(PRECISION));
    tokenB = await Token.deploy('DAI', 'DAI', BN.from(100000000000).mul(PRECISION));
    [tokenA, tokenB] = orderTokens(tokenA, tokenB);
    factory = await deployFactory(admin, vestingPeriod);

    const WETH = (await ethers.getContractFactory('MockWeth')) as MockWeth__factory;
    weth = await WETH.deploy();

    const Descriptor = (await ethers.getContractFactory(
      'MockTokenPositionDescriptor'
    )) as MockTokenPositionDescriptor__factory;
    tokenDescriptor = await Descriptor.deploy();

    PositionManager = (await ethers.getContractFactory('BasePositionManager')) as BasePositionManager__factory;
    positionManager = await PositionManager.deploy(factory.address, weth.address, tokenDescriptor.address);
    await factory.connect(admin).addNFTManager(positionManager.address);
    positionHelper = await PositionHelper.deploy(positionManager.address, ZERO_ADDRESS);

    const Router = (await ethers.getContractFactory('Router')) as Router__factory;
    router = await Router.deploy(factory.address, weth.address);

    // add any newly defined tickDistance apart from default ones
    for (let i = 0; i < swapFeeUnitsArray.length; i++) {
      if ((await factory.feeAmountTickDistance(swapFeeUnitsArray[i])) == 0) {
        await factory.connect(admin).enableSwapFee(swapFeeUnitsArray[i], tickDistanceArray[i]);
      }
    }

    initialPrice = encodePriceSqrt(1, 1);

    await weth.connect(user).deposit({value: PRECISION.mul(10)});
    await weth.connect(other).deposit({value: PRECISION.mul(10)});

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
          balances.push(await ethers.provider.getBalance(account));
        } else {
          balances.push(await (await Token.attach(tokens[i])).balanceOf(account));
        }
      }
      return {
        tokenBalances: balances,
      };
    };

    initialSnapshotId = await snapshot();
    snapshotId = initialSnapshotId;
  });

  const createAndUnlockPools = async () => {
    let initialPrice = encodePriceSqrt(1, 1);
    let [token0, token1] = sortTokens(tokenA.address, tokenB.address);
    await positionManager
      .connect(user)
      .createAndUnlockPoolIfNecessary(token0, token1, swapFeeUnitsArray[0], initialPrice);
    [token0, token1] = sortTokens(tokenA.address, weth.address);
    await positionManager
      .connect(user)
      .createAndUnlockPoolIfNecessary(token0, token1, swapFeeUnitsArray[0], initialPrice);
    [token0, token1] = sortTokens(tokenB.address, weth.address);
    await positionManager
      .connect(user)
      .createAndUnlockPoolIfNecessary(token0, token1, swapFeeUnitsArray[0], initialPrice);
  };


  const swapExactInput = async function (tokenIn: string, tokenOut: string, poolFee: number, amount: BigNumber) {
    const swapParams = {
      tokenIn: tokenIn,
      tokenOut: tokenOut,
      fee: poolFee,
      recipient: user.address,
      deadline: BN.from(2).pow(255),
      amountIn: amount,
      minAmountOut: BN.from(0),
      limitSqrtP: BN.from(0),
    };
    await router.connect(user).swapExactInputSingle(swapParams);
  };

  describe(`change price range`, async () => {
    before('create and unlock pools', async () => {
      await revertToSnapshot(initialSnapshotId);
      initialSnapshotId = await snapshot();
      await createAndUnlockPools();
      snapshotId = await snapshot();
    });

    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
      nextTokenId = await positionManager.nextTokenId();
    });

    it('mint then change price range', async () => {
      let [token0, token1] = sortTokens(tokenA.address, tokenB.address);

      let recipients = [user.address];

      let _nextTokenId = nextTokenId;

      let poolAddress = await factory.getPool(token0, token1, swapFeeUnitsArray[0]);
      let pool = (await ethers.getContractAt('Pool', poolAddress)) as Pool;

      let liquidityDesired = [200510416];

      for (let i = 0; i < recipients.length; i++) {
        let tickLower = tickDistanceArray[0] * (i + 1) * -10;
        let tickUpper = tickDistanceArray[0] * (i + 1) * 10;

        let _ticksPrevious = await getTicksPrevious(pool, tickLower, tickUpper);
        let tx;

        await expect(
          (tx = await positionManager.connect(user).mint({
            token0: token0,
            token1: token1,
            fee: swapFeeUnitsArray[0],
            tickLower: tickLower,
            tickUpper: tickUpper,
            ticksPrevious: _ticksPrevious,
            amount0Desired: BN.from(1000000),
            amount1Desired: BN.from(1000000),
            amount0Min: 0,
            amount1Min: 0,
            recipient: recipients[i],
            deadline: PRECISION,
          }))
        )
          .to.emit(positionManager, 'MintPosition')
          .withArgs(i + 1, 1, liquidityDesired[i], 1000000, 1000000);

        // made some swaps to get fees
        for (let j = 0; j < 5; j++) {
          await swapExactInput(tokenA.address, tokenB.address, swapFeeUnitsArray[0], BN.from(10000 * (j + 1)));
          await swapExactInput(tokenB.address, tokenA.address, swapFeeUnitsArray[0], BN.from(10000 * (j + 1)));
        }

        await positionManager.connect(user).approve(positionHelper.address, _nextTokenId);
        await positionHelper.connect(user).changeTickRange(
          _nextTokenId,
          token0,
          token1,
          { // RemoveLiquidityParams
            tokenId: _nextTokenId,
            liquidity: BN.from(liquidityDesired[i]),
            amount0Min: BN.from(1),
            amount1Min: BN.from(1),
            deadline: PRECISION,
          },
          { // BurnRTokenParams
            tokenId: _nextTokenId,
            amount0Min: BN.from(1),
            amount1Min: BN.from(1),
            deadline: PRECISION,
          },
          { // MintParams
            token0: token0,
            token1: token1,
            fee: swapFeeUnitsArray[0],
            tickLower: tickLower-10,
            tickUpper: tickUpper+10,
            ticksPrevious: _ticksPrevious,
            amount0Desired: BN.from(10000),
            amount1Desired: BN.from(10000),
            amount0Min: 0,
            amount1Min: 0,
            recipient: recipients[i],
            deadline: PRECISION,
          },
          '0x'
        );

        // verify user should be the owner of _nextTokenId
        expect(await positionManager.balanceOf(recipients[i])).to.be.eq(1);
        expect(await positionManager.tokenOfOwnerByIndex(recipients[i], 0)).to.be.eq(_nextTokenId.add(1));
        expect(await positionManager.ownerOf(_nextTokenId.add(1))).to.be.eq(recipients[i]);

        _nextTokenId = _nextTokenId.add(2);
      }
    });
  });
});
