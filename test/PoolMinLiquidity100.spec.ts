import {ethers, waffle} from 'hardhat';
import {expect} from 'chai';
import {BigNumber as BN} from 'ethers';
import chai from 'chai';
const {solidity, loadFixture} = waffle;
chai.use(solidity);

import {
  MockFactory,
  MockPool,
  MockTokenV2 as MockToken,
  MockTokenV2__factory as MockToken__factory,
  MockPool__factory,
} from '../typechain';
import {QuoterV2, QuoterV2__factory, MockCallbacks, MockCallbacks__factory} from '../typechain';

import {MIN_TICK, MAX_TICK} from './helpers/helper';
import {MAX_UINT, PRECISION} from './helpers/helper';
import {deployMockFactory} from './helpers/setup';
import {getMaxTick, getMinTick} from './helpers/utils';
import {getPriceFromTick} from './helpers/utils';

let factory: MockFactory;
let token0s: MockToken[] = [];
let token1s: MockToken[] = [];
let swapFeeUnitsArray = [50, 300];
let swapFeeUnits = swapFeeUnitsArray[0];
let tickDistanceArray = [10, 60];
let tickDistance = tickDistanceArray[0];
let vestingPeriod = 100;
let initialPrice: BN;

class Fixtures {
  constructor(public factory: MockFactory, public token0s: MockToken[], public token1s: MockToken[]) {}
}

describe('Pool', () => {
  const [user, admin] = waffle.provider.getWallets();

  async function fixture(): Promise<Fixtures> {
    let factory = await deployMockFactory(admin, vestingPeriod);
    const PoolContract = (await ethers.getContractFactory('MockPool')) as MockPool__factory;

    await factory.connect(admin).enableSwapFee(swapFeeUnits, tickDistance);

    const MockTokenContract = (await ethers.getContractFactory('MockTokenV2')) as MockToken__factory;

    for (let i = 1; i < 19; i++) {
      const token0 = await MockTokenContract.deploy('TK' + i, 'TK' + i, PRECISION.mul(PRECISION), i);
      const token1 = await MockTokenContract.deploy('TK' + i, 'TK' + i, PRECISION.mul(PRECISION), i);

      token0s.push(token0);
      token1s.push(token1);
    }

    return new Fixtures(factory, token0s, token1s);
  }

  beforeEach('load fixture', async () => {
    ({factory, token0s, token1s} = await loadFixture(fixture));
  });

  describe('#unlockPool', async () => {
    for (let i = 0; i < 18; i++) {
      for (let j = 0; j < 18; j++) {
        describe(`#pair decimals ${i + 1} - ${j + 1}`, async () => {
          let token0: MockToken;
          let token1: MockToken;
          let decimalToken0: number;
          let decimalToken1: number;
          let pool: MockPool;
          let callback: MockCallbacks;

          beforeEach('create pool, deploy callback contrac, approve tokens', async () => {
            const tokenA = token0s[i];
            const tokenB = token1s[j];

            if (tokenA.address.toLowerCase() < tokenB.address.toLowerCase()) {
              token0 = tokenA;
              token1 = tokenB;

              decimalToken0 = i + 1;
              decimalToken1 = j + 1;
            } else {
              token0 = tokenB;
              token1 = tokenA;

              decimalToken0 = j + 1;
              decimalToken1 = i + 1;
            }

            await factory.createPool(token0.address, token1.address, swapFeeUnits);
            const poolAddress = await factory.getPool(token0.address, token1.address, swapFeeUnits);

            const PoolContract = (await ethers.getContractFactory('MockPool')) as MockPool__factory;
            pool = PoolContract.attach(poolAddress);

            const CallbackContract = (await ethers.getContractFactory('MockCallbacks')) as MockCallbacks__factory;

            callback = await CallbackContract.deploy(token0.address, token1.address);

            // user give token approval to callbacks
            await token0.approve(callback.address, MAX_UINT);
            await token1.approve(callback.address, MAX_UINT);
          });

          it('correctly set token decimals', async () => {
            expect(await token0.decimals()).to.be.equals(decimalToken0);
            expect(await token1.decimals()).to.be.equals(decimalToken1);
          });

          it('should unlockPool tick: 10', async () => {
            initialPrice = await getPriceFromTick(10);

            let balanceToken0Before = await token0.balanceOf(user.address);
            let balanceToken1Before = await token1.balanceOf(user.address);

            await callback.unlockPool(pool.address, initialPrice);

            let balanceToken0After = await token0.balanceOf(user.address);
            let balanceToken1After = await token1.balanceOf(user.address);

            expect(balanceToken0After.sub(balanceToken0Before).toString()).to.be.equals('-100');
            expect(balanceToken1After.sub(balanceToken1Before).toString()).to.be.equals('-101');
          });

          it('should unlockPool tick: MIN_TICK', async () => {
            initialPrice = await getPriceFromTick(MIN_TICK);

            let balanceToken0Before = await token0.balanceOf(user.address);
            let balanceToken1Before = await token1.balanceOf(user.address);

            await callback.unlockPool(pool.address, initialPrice);

            let balanceToken0After = await token0.balanceOf(user.address);
            let balanceToken1After = await token1.balanceOf(user.address);

            expect(balanceToken0After.sub(balanceToken0Before).toString()).to.be.equals('-1844605070736724606325');
            expect(balanceToken1After.sub(balanceToken1Before).toString()).to.be.equals('-1');
          });

          it('should unlockPool tick: MAX_TICK', async () => {
            initialPrice = await getPriceFromTick(MAX_TICK.sub(BN.from(1))); // not accepted MAX_TICK price so we gonna subtract it by 1

            let balanceToken0Before = await token0.balanceOf(user.address);
            let balanceToken1Before = await token1.balanceOf(user.address);

            await callback.connect(user).unlockPool(pool.address, initialPrice);

            let balanceToken0After = await token0.balanceOf(user.address);
            let balanceToken1After = await token1.balanceOf(user.address);

            expect(balanceToken0After.sub(balanceToken0Before).toString()).to.be.equals('-1');
            expect(balanceToken1After.sub(balanceToken1Before).toString()).to.be.equals('-1844512847772907492515');
          });
        });
      }
    }
  });
});
