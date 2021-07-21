import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {BN, PRECISION, ZERO_ADDRESS, BPS_PLUS_ONE, ZERO, ONE, BPS, MAX_UINT, TWO_POW_96} from './helpers/helper';
import chai from 'chai';
const {solidity} = waffle;
chai.use(solidity);

import {ProAMMFactory, ProAMMPool, MockToken, MockToken__factory, MockProAMMCallbacks} from '../typechain';
import {deployFactory} from './helpers/proAMMSetup';
import {snapshot, revertToSnapshot} from './helpers/hardhat';

let Token: MockToken__factory;
let admin;
let user;
let factory: ProAMMFactory;
let tokenA: MockToken;
let tokenB: MockToken;
let poolArray: ProAMMPool[] = [];
let pool: ProAMMPool;
let callback: MockProAMMCallbacks;
let swapFeeBpsArray = [5, 30];
let swapFeeBps = swapFeeBpsArray[0];
let tickSpacingArray = [10, 60];
let tickSpacing = tickSpacingArray[0];

let firstSnapshot: any;
let snapshotId: any;

describe('ProAMMPool', () => {
  const [user, admin, feeToSetter] = waffle.provider.getWallets();

  before('factory, token and callback setup', async () => {
    Token = (await ethers.getContractFactory('MockToken')) as MockToken__factory;
    tokenA = await Token.deploy('USDC', 'USDC', BN.from(1000000).mul(PRECISION));
    tokenB = await Token.deploy('DAI', 'DAI', BN.from(1000000).mul(PRECISION));
    factory = await deployFactory(ethers, admin, ZERO_ADDRESS, ZERO_ADDRESS);
    let Callback = await ethers.getContractFactory('MockProAMMCallbacks');
    callback = (await Callback.deploy(tokenA.address, tokenB.address)) as MockProAMMCallbacks;
    // user give token approval to callback
    await tokenA.connect(user).approve(callback.address, MAX_UINT);
    await tokenB.connect(user).approve(callback.address, MAX_UINT);
    // add any newly defined tickSpacing apart from default ones
    for (let i = 0; i < swapFeeBpsArray.length; i++) {
      if ((await factory.feeAmountTickSpacing(swapFeeBpsArray[i])) == 0) {
        await factory.connect(admin).enableSwapFee(swapFeeBpsArray[i], tickSpacingArray[i]);
      }
    }
  });

  describe('#test pool deployment and initialization', async () => {
    before('deploy pool and take snapshot', async () => {
      // for revert to before pool creation
      firstSnapshot = await snapshot();
      await factory.createPool(tokenA.address, tokenB.address, swapFeeBps);
      pool = (await ethers.getContractAt(
        'ProAMMPool',
        await factory.getPool(tokenA.address, tokenB.address, swapFeeBps)
      )) as ProAMMPool;
      snapshotId = await snapshot();
    });
    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
    });
    after('revert to first snapshot', async () => {
      await revertToSnapshot(firstSnapshot);
    });

    it('should have initialized required settings', async () => {
      expect(await pool.factory()).to.be.eql(factory.address);
      let token0Address = tokenA.address < tokenB.address ? tokenA.address : tokenB.address;
      let token1Address = token0Address == tokenA.address ? tokenB.address : tokenA.address;
      expect(await pool.token0()).to.be.eql(token0Address);
      expect(await pool.token1()).to.be.eql(token1Address);
      expect(await pool.swapFeeBps()).to.be.eql(swapFeeBps);
      expect(await pool.tickSpacing()).to.be.eql(tickSpacing);
      expect(await pool.maxLiquidityPerTick()).to.be.gt(ZERO);
    });

    it('should be unable to call initialize() on the pool again', async () => {
      await expect(
        pool.initialize(factory.address, tokenA.address, tokenB.address, swapFeeBps, tickSpacing)
      ).to.be.revertedWith('already inited');
      await expect(
        pool.initialize(ZERO_ADDRESS, tokenA.address, tokenB.address, swapFeeBps, tickSpacing)
      ).to.be.revertedWith('already inited');
    });

    it('pool creation should be unaffected by poolMaster configuration', async () => {
      pool = (await ethers.getContractAt('ProAMMPool', await factory.poolMaster())) as ProAMMPool;
      // init poolMaster
      await pool.initialize(factory.address, tokenA.address, tokenB.address, swapFeeBps, tickSpacing);
      swapFeeBps = swapFeeBpsArray[1];
      // should still be able to create pool even though poolMaster was inited
      await factory.createPool(tokenA.address, tokenB.address, swapFeeBps);
      // verify address not null
      expect(await factory.getPool(tokenA.address, tokenB.address, swapFeeBps)).to.not.eql(ZERO_ADDRESS);
      // reset swapFeeBps
      swapFeeBps = swapFeeBpsArray[0];
    });
  });

  // TODO: for initial gas profiling, remove when more robust tests have been added
  describe('mint and swap to get gas costs', async () => {
    before('deploy pools and take snapshot', async () => {
      // for revert to before pool creation
      firstSnapshot = await snapshot();
      // create pools
      for (let i = 0; i < swapFeeBpsArray.length; i++) {
        await factory.createPool(tokenA.address, tokenB.address, swapFeeBpsArray[i]);
        poolArray.push((await ethers.getContractAt(
            'ProAMMPool',
            await factory.getPool(tokenA.address, tokenB.address, swapFeeBpsArray[i])
          )) as ProAMMPool);
      }
      snapshotId = await snapshot();
    });
    beforeEach('revert to snapshot', async () => {
      await revertToSnapshot(snapshotId);
      snapshotId = await snapshot();
    });
    after('revert to first snapshot', async () => {
      await revertToSnapshot(firstSnapshot);
      poolArray = [];
    });

    it('should be able to mint liquidity and do swap', async () => {
      for (let i = 0; i < poolArray.length; i++) {
        pool = poolArray[i];
        await callback.connect(user).unlockPool(pool.address, BN.from('79704936542881920863903188246'), user.address, tickSpacingArray[i], 100 * tickSpacingArray[i], PRECISION, '0x');
        await callback.connect(user).swap(pool.address, user.address, PRECISION.div(100000), true, BN.from('4295128740'), '0x');
      };
    });
  });
});
