import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {BigNumber} from 'ethers';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {
  MockToken,
  MockToken__factory,
  MockWeth,
  MockWeth__factory,
  AntiSnipAttackPositionManager,
  NonfungiblePositionManagerSnipAttack__factory,
  Router__factory,
  Router,
  Factory,
  MockTokenPositionDescriptor,
  MockTokenPositionDescriptor__factory,
} from '../../typechain';

import {deployFactory} from '../helpers/setup';
import {snapshot, revertToSnapshot} from '../helpers/hardhat';
import {BN, PRECISION, ZERO, MIN_TICK} from '../helpers/helper';
import {encodePriceSqrt, sortTokens} from '../helpers/utils';

const txGasPrice = BN.from(100).mul(BN.from(10).pow(9));
const showTxGasUsed = true;

const BIG_AMOUNT = BN.from(2).pow(255);

let Token: MockToken__factory;
let PositionManager: NonfungiblePositionManagerSnipAttack__factory;
let factory: Factory;
let positionManager: AntiSnipAttackPositionManager;
let router: Router;
let tokenDescriptor: MockTokenPositionDescriptor;
let tokenA: MockToken;
let tokenB: MockToken;
let token0: string;
let token1: string;
let weth: MockWeth;
let nextTokenId: BigNumber;
let swapFeeBpsArray = [5, 30];
let tickDistanceArray = [10, 60];
let ticksPrevious: [BigNumber, BigNumber] = [MIN_TICK, MIN_TICK];
let vestingPeriod = 100;
let initialPrice: BigNumber;
let snapshotId: any;
let initialSnapshotId: any;

describe('AntiSnipAttackPositionManager', () => {
  const [user, admin] = waffle.provider.getWallets();
  const tickLower = -100 * tickDistanceArray[0];
  const tickUpper = 100 * tickDistanceArray[0];

  before('factory, token and callback setup', async () => {
    Token = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    tokenA = await Token.deploy('USDC', 'USDC', BN.from(100000000000).mul(PRECISION));
    tokenB = await Token.deploy('DAI', 'DAI', BN.from(100000000000).mul(PRECISION));
    factory = await deployFactory(admin, vestingPeriod);

    const WETH = (await ethers.getContractFactory('MockWeth')) as MockWeth__factory;
    weth = await WETH.deploy();

    const Descriptor = (await ethers.getContractFactory(
      'MockTokenPositionDescriptor'
    )) as MockTokenPositionDescriptor__factory;
    tokenDescriptor = await Descriptor.deploy();

    PositionManager = (await ethers.getContractFactory(
      'AntiSnipAttackPositionManager'
    )) as NonfungiblePositionManagerSnipAttack__factory;
    positionManager = await PositionManager.deploy(factory.address, weth.address, tokenDescriptor.address);
    await factory.connect(admin).addNFTManager(positionManager.address);

    const Router = (await ethers.getContractFactory('Router')) as Router__factory;
    router = await Router.deploy(factory.address, weth.address);

    // add any newly defined tickDistance apart from default ones
    for (let i = 0; i < swapFeeBpsArray.length; i++) {
      if ((await factory.feeAmountTickSpacing(swapFeeBpsArray[i])) == 0) {
        await factory.connect(admin).enableSwapFee(swapFeeBpsArray[i], tickDistanceArray[i]);
      }
    }

    initialPrice = encodePriceSqrt(1, 1);

    await weth.connect(user).deposit({value: PRECISION.mul(10)});

    await weth.connect(user).approve(positionManager.address, BIG_AMOUNT);
    await tokenA.connect(user).approve(positionManager.address, BIG_AMOUNT);
    await tokenB.connect(user).approve(positionManager.address, BIG_AMOUNT);

    await weth.connect(user).approve(router.address, BIG_AMOUNT);
    await tokenA.connect(user).approve(router.address, BIG_AMOUNT);
    await tokenB.connect(user).approve(router.address, BIG_AMOUNT);

    await tokenA.transfer(user.address, PRECISION.mul(2000000));
    await tokenB.transfer(user.address, PRECISION.mul(2000000));

    [token0, token1] = sortTokens(tokenA.address, tokenB.address);

    initialSnapshotId = await snapshot();
    snapshotId = initialSnapshotId;
  });

  const createAndUnlockPools = async () => {
    let initialPrice = encodePriceSqrt(1, 1);
    let [token0, token1] = sortTokens(tokenA.address, tokenB.address);
    await positionManager
      .connect(user)
      .createAndUnlockPoolIfNecessary(token0, token1, swapFeeBpsArray[0], initialPrice);
    [token0, token1] = sortTokens(tokenA.address, weth.address);
    await positionManager
      .connect(user)
      .createAndUnlockPoolIfNecessary(token0, token1, swapFeeBpsArray[0], initialPrice);
    [token0, token1] = sortTokens(tokenB.address, weth.address);
    await positionManager
      .connect(user)
      .createAndUnlockPoolIfNecessary(token0, token1, swapFeeBpsArray[0], initialPrice);
  };

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

    it('should initialize antiSnipAttackData for the minted position', async () => {
      let _nextTokenId = nextTokenId;
      await positionManager.connect(user).mint({
        token0: token0,
        token1: token1,
        fee: swapFeeBpsArray[0],
        tickLower: tickLower,
        tickUpper: tickUpper,
        ticksPrevious: ticksPrevious,
        amount0Desired: BN.from(1000000),
        amount1Desired: BN.from(1000000),
        amount0Min: 0,
        amount1Min: 0,
        recipient: user.address,
        deadline: PRECISION,
      });

      let antiSnipAttackData = await positionManager.antiSnipAttackData(_nextTokenId);
      expect(antiSnipAttackData.lastActionTime).to.be.gt(ZERO);
      expect(antiSnipAttackData.lockTime).to.be.gt(ZERO);
      expect(antiSnipAttackData.unlockTime).to.be.gt(ZERO);
      expect(antiSnipAttackData.feesLocked).to.be.eq(ZERO);
    });
  });
});
